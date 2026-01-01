# ---- 1) Imagem base leve ----
FROM node:20-alpine AS base

# Criar diretório da aplicação
WORKDIR /app

# ---- 2) Copiar apenas arquivos essenciais ----
COPY package*.json ./

# ---- 3) Instalar dependências ----
RUN npm install --omit=dev

# ---- 4) Copiar o restante do projeto ----
COPY . .

# ---- 5) Expor porta usada pelo Express ----
EXPOSE 4000

# ---- 6) Subir servidor ----
CMD ["node", "src/index.js"]
