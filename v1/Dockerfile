FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787

COPY index5.html mq5bhoxr-image.png ./
COPY backend ./backend

WORKDIR /app/backend

EXPOSE 8787

CMD ["npm", "start"]
