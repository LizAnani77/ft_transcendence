FROM alpine:3.19

USER root

COPY scripts/init-volumes.sh /usr/local/bin/init-volumes.sh
RUN chmod +x /usr/local/bin/init-volumes.sh

ENTRYPOINT ["/usr/local/bin/init-volumes.sh"]
