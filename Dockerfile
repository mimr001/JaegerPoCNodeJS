FROM node:8.6.0-alpine

WORKDIR /usr/src/app

COPY package.json package-lock.json ./

RUN npm install

COPY . .

EXPOSE 8080
CMD [ "npm", "start" ]