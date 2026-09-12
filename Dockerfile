FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    git \
    openssh-client \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/

COPY package*.json ./

RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

EXPOSE 54321

CMD ["npm", "start"]