FROM node:10-alpine

# Install dependencies (i.e. for compiling bcrypt)
RUN apk --no-cache add --virtual native-deps \
  g++ gcc libgcc libstdc++ linux-headers autoconf automake make nasm python git && \
  npm install --quiet node-gyp -g

WORKDIR /usr/app

# Setup NPM packages
# The Dockerfile requires `--build-arg NPM_TOKEN` dependency for @sierralabs packages
# You can create an NPM Token by running `npm token create --read-only`
ARG NPM_TOKEN
COPY package.json .
COPY docker/.npmrc .
COPY docker/start-script.sh .
RUN chmod a+x ./start-script.sh
RUN npm install --loglevel=error --production
RUN rm -f .npmrc
RUN apk del native-deps

# Pass in the NODE_ENV variable or default to `development`
ARG NODE_ENV=development
ENV NODE_ENV ${NODE_ENV}
ENV ENTITY_PATH=dist

COPY build ./
RUN npm install pm2 -g --loglevel=error

EXPOSE 3000

CMD ["./start-script.sh"]
