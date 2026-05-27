# Dockerfile pour l'agent Vault WAF
FROM hashicorp/vault:1.20.2

USER root

RUN apk add --no-cache shadow

RUN groupmod -g 1000 vault && \
    usermod -u 1000 vault

RUN mkdir -p /config/templates /secrets && \
    chown -R 1000:1000 /config /secrets && \
    chmod -R 755 /config && \
    chmod -R 700 /secrets

COPY agent.hcl /config/agent.hcl
COPY templates/ /config/templates/

RUN chown -R 1000:1000 /config/agent.hcl /config/templates && \
    chmod 644 /config/agent.hcl && \
    chmod -R 644 /config/templates/* && \
    find /config/templates -type d -exec chmod 755 {} \; && \
    find /config/templates -type f -exec chmod 644 {} \;

USER 1000

ENTRYPOINT ["/bin/vault"]
CMD ["agent","-config=/config/agent.hcl"]
