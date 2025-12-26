FROM node:18-alpine
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm install --production

# Copy sources
COPY . .

# Run the bot (uses npm start -> node index.js)
CMD ["npm", "start"]
