# Use a stable Node.js base image
FROM node:20-alpine

# Set working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first (for caching)
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of your code
COPY . .

# Expose port (if you ever add an API/dashboard)
EXPOSE 3000

# Start the bot
CMD ["npm", "start"]
