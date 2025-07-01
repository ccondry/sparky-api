FROM public.ecr.aws/docker/library/node:lts-alpine AS builder

# Create app directory in docker image
WORKDIR /usr/src/app

# copy local src files to docker app directory
COPY . /usr/src/app/

# Install app dependencies in docker
RUN npm install

# expose TCP port 3020 in docker image when it's running
EXPOSE 3020

CMD [ "npm", "start" ]