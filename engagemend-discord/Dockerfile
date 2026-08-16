FROM python:3.12-slim AS python-deps

COPY engagemend-youtube/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --prefix=/usr/local --index-url https://download.pytorch.org/whl/cpu "torch>=1.11"
RUN pip install --no-cache-dir --prefix=/usr/local -r /tmp/requirements.txt

FROM node:20-trixie-slim AS base

COPY --from=python-deps /usr/local /usr/local

RUN corepack enable && corepack prepare pnpm@10.12.4 --activate

WORKDIR /app

COPY engagemend-discord/package.json engagemend-discord/pnpm-lock.yaml engagemend-discord/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY engagemend-discord/prisma ./prisma
RUN pnpm prisma generate

COPY engagemend-discord ./
COPY engagemend-youtube /app/engagemend-youtube
COPY interface_da_engagemend /app/interface_da_engagemend

RUN pip install --break-system-packages -r /app/engagemend-youtube/requirements.txt

RUN sh /app/interface_da_engagemend/_build/montar.sh
RUN cp /app/interface_da_engagemend/engagemend-painel-v4-http.html /app/engagemend-painel-v4-http.html

EXPOSE 3000

CMD ["sh", "-c", "pnpm prisma migrate deploy && pnpm start"]
