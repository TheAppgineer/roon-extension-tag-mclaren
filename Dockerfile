# Use an official node runtime as a parent image
FROM node:12.16.3-alpine

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

COPY t*.js LICENSE package.json /usr/src/app/

RUN apk add --no-cache g++ git linux-headers make python && \
    npm install && \
    apk del g++ git linux-headers make python

CMD [ "node", "." ]
