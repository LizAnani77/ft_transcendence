# Image de seed pour précharger les fichiers initiaux dans /uploads
FROM alpine:3.19

USER root

COPY ./uploads/ /seed/
COPY ./uploads/seed-entrypoint.sh /usr/local/bin/seed-entrypoint.sh
RUN chmod +x /usr/local/bin/seed-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/seed-entrypoint.sh"]
