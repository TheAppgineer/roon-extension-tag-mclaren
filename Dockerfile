ARG build_arch=amd64

FROM multiarch/alpine:${build_arch}-v3.12

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

COPY t*.js LICENSE package.json /usr/src/app/

RUN apk add --no-cache g++ git linux-headers make python3 nodejs npm && \
    npm install && \
    apk del g++ git linux-headers make python3 npm

CMD [ "node", "." ]
