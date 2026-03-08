# ---- 1) Imagem base leve ----
FROM node:20-alpine AS base

# Criar diretório da aplicação
WORKDIR /app

# ---- 2) Copiar apenas arquivos essenciais ----
COPY package*.json ./

# ---- 3) Instalar utilitários do sistema ----
RUN apk add --no-cache postgresql-client

# ---- 4) Instalar dependências ----
RUN npm install --omit=dev

# ---- 5) Copiar o restante do projeto ----
COPY . .

# ---- 6) Expor porta usada pelo Express ----
EXPOSE 4000

# ---- 7) Subir servidor ----
CMD ["node", "src/index.js"]
