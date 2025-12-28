Login

POST /api/auth/login
Body JSON:

{ "email": "admin@loja.com", "password": "senha123" }


Resposta:

{ "token": "JWT...", "user": { "id": "...", "email": "...", "name": "..." } }


O frontend deve guardar token em memória/localStorage e enviar Authorization: Bearer <token> nas rotas protegidas.

Esqueci senha

POST /api/auth/forgot
Body: { "email": "admin@loja.com" }
Se o e-mail existir, o backend gera código e envia. Para evitar enumeração de e-mail, resposta é sempre { ok: true }.

Resetar senha

POST /api/auth/reset
Body: { "email": "...", "code": "123456", "newPassword": "novaSenha" }

Criar pedido (cliente)

POST /api/orders — pública, para quando cliente fechar pedido:

{
  "external_id": "ABC123",
  "customer_name": "João",
  "customer_whatsapp": "+5511999000111",
  "delivery_address": "Rua A, 123",
  "payment_method": "PIX",
  "total": 45.50,
  "notes": "Sem cebola",
  "items": [
    {"product_name":"X-Bacon","quantity":1,"unit_price":20.00},
    {"product_name":"Refrigerante","quantity":1,"unit_price":5.50}
  ]
}

Listar pedidos (painel)

GET /api/orders — requer Authorization (JWT).

Obter pedido

GET /api/orders/{id} — pode ser id interno (UUID) ou external_id enviado no pedido.

Atualizar status

PUT /api/orders/{id}/status
Body: { "status": "Entregue", "payment_status": "paid" } — requer Authorization.

🔁 Integração com o frontend que criamos

No fluxo de checkout do cliente: ao confirmar o pedido use POST /api/orders para gravar o pedido no backend. O backend retorna o order.id (UUID) e external_id se presente.

No WhatsApp, você ainda pode enviar o texto para o restaurante, mas inclua o external_id (ou id) no texto, ex: Pedido #ABC123 — consulte painel: https://seusite/admin/pedido/ABC123

O painel admin (frontend) usa POST /api/auth/login para obter token e depois chama GET /api/orders e GET /api/orders/:id com Authorization: Bearer <token>.

🔧 Observações de segurança e produção

Em produção, proteja a rota /register — use-a apenas para criar os primeiros usuários e depois remova/disable.

Troque a JWT_SECRET por uma string segura e longa, guarde em variáveis de ambiente.

Use HTTPS no domínio onde hospedar o backend.

Configure o SMTP com um provedor confiável (SendGrid, Mailgun, Amazon SES, etc).

Se quiser alta segurança para senhas: na criação de usuários, use bcrypt com salt (já feito). Se desejar ainda mais, adicione rate limiting por IP para endpoints de login/forgot.

Para escalar, considere usar fila para envio de e-mail (Bull + Redis).

✅ Passos rápidos para rodar local (com Docker)

Copie os arquivos para backend/

Crie .env a partir de .env.example e ajuste DATABASE_URL se necessário.

docker compose up -d (rodará o Postgres)

Instale dependências: npm install

Rode migrations: npm run migrate (rodará schema.sql conectando-se ao DATABASE_URL)

Crie um usuário admin (opção rápida via cURL):

curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@loja.com","password":"senha123","name":"Admin"}'


Start server: npm run dev (ou npm start)

Teste login: POST /api/auth/login → pegue token → teste GET /api/orders com header Authorization.


*********************** PROXIMO PASSO ****************************************
TESTAR NO POSTMAN
FAZER DEPLOY