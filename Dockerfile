FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends bash ca-certificates curl git jq python3 ripgrep sqlite3 tini util-linux \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY prompts ./prompts
COPY skills ./skills
COPY templates ./templates
COPY docker/entrypoint.sh /usr/local/bin/nano-entrypoint
RUN chmod 755 /usr/local/bin/nano-entrypoint \
 && ln -s /app/skills/food/food-tracking/scripts/food.py /usr/local/bin/food

ENV NANO_DATA_DIR=/data NODE_ENV=production NODE_NO_WARNINGS=1
VOLUME /data
ENTRYPOINT ["tini", "--", "nano-entrypoint"]
CMD ["node", "/app/src/index.ts"]
