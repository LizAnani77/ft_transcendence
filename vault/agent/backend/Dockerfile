# Dockerfile pour l'agent Vault backend
FROM hashicorp/vault:1.20.2

USER root

RUN apk add --no-cache shadow jq openssl

RUN groupmod -g 1000 vault && \
    usermod -u 1000 vault

RUN mkdir -p /config/templates /secrets && \
    chown -R 1000:1000 /config /secrets && \
    chmod -R 755 /config && \
    chmod -R 700 /secrets  # Secrets doivent être plus restrictifs

COPY agent.hcl /config/agent.hcl
COPY templates/app.env.ctmpl /config/templates/app.env.ctmpl

RUN chown 1000:1000 /config/agent.hcl /config/templates/app.env.ctmpl && \
    chmod 644 /config/agent.hcl /config/templates/app.env.ctmpl

USER 1000

ENTRYPOINT ["/bin/vault"]
CMD ["agent","-config=/config/agent.hcl"]
