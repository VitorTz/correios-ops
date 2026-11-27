# Correios Floripa Ops (v1.0.0 — Sistema Completo: Fases 1 a 4)

Sistema full-stack em TypeScript (Next.js App Router + NeonDB/PostGIS + Inngest + Google Maps Platform Caminho A + ViaCEP/BrasilAPI) pronto para deploy na Vercel e execucao local.

## Modulos entregues
- **Fase 1 (Base & Dados):** Schema PostgreSQL/PostGIS (`sql/001_init.sql`), validacao estrita de CEP da Ilha (`88010-000` ate `88059-999`), fallback ViaCEP -> BrasilAPI, parser do layout dos Correios com destaque exclusivo para `AR`.
- **Fase 2 (Motor Assincrono — Caminho A):** Pipeline duravel em etapas via Inngest (funciona na Vercel e localmente mesmo fechando o site), Google Geocoding com cache de 30 dias, clusterizacao Ancora + Adjacentes via `computeRouteMatrix` (`WALK`) e otimizacao global via `optimizeTours` (suportando 200+ encomendas).
- **Fase 3 (Aba 1 — Rotas):** Multiplas rotas por dia, aviso de rota desatualizada com botao manual `Atualizar Rota`, mapa interativo com setas de ida/volta, agrupamento de Ancora + Adjacentes, ajuste manual de pino isolado por rota (com propagacao opcional para o cache futuro), gestao das 4 listas (copia em L2/L3 e movimentacao L1 <-> L4), horarios do CEE, fechamento de KM real, log de ocorrencias e Modo de Campo Mobile (Google Maps / Waze + baixa rapida).
- **Fase 4 (Aba 2 — Financeiro & Parametros):** Consolidado quinzenal padrao (1a e 2a quinzena + intervalo customizado), filtrando exclusivamente rotas `completa`, descontando Listas 2, 3 e 4 dos `R$ 2,11`, calculo de combustivel em `10 km/L`, evolucao diaria, exportacao CSV compativel com Excel e modal de Parametros Globais.

## Como rodar localmente
1. `npm install`
2. Copie `.env.example` para `.env.local` e preencha `DATABASE_URL` (NeonDB pooled), `GOOGLE_MAPS_SERVER_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `GOOGLE_CLOUD_PROJECT_ID` e `GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON`.
3. Aplique o banco: `psql "$DATABASE_URL" -f sql/001_init.sql`
4. Rode em dois terminais:
   - `npm run dev`
   - `npm run inngest:dev`

## Deploy na Vercel
1. Conecte o repositorio na Vercel e cadastre as mesmas variaveis do `.env.example` (incluindo `INNGEST_EVENT_KEY` e `INNGEST_SIGNING_KEY` via integracao Inngest no Marketplace da Vercel).
2. Faca o deploy: o endpoint `/api/inngest` e registrado automaticamente para manter os calculos assincronos rodando em producao.
