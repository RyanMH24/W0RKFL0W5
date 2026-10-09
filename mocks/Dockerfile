FROM public.ecr.aws/docker/library/node:24-alpine
WORKDIR /app
COPY server.mjs .
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
