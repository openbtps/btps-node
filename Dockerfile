# Use official Node base image
FROM node:20.11.1-alpine

# Create app directory
WORKDIR /var/www

# Copy app files
COPY package*.json ./
COPY yarn.lock ./
COPY .yarnrc.yml ./
COPY tsconfig.json ./
COPY .well-known/ ./.well-known/
COPY build/ ./build/
COPY src/ ./src/
RUN yarn install && yarn build

# Expose the app port
EXPOSE 3443

# Start the app
CMD ["node", "./dist/server/index.js"]
