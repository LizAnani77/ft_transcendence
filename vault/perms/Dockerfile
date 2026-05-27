FROM hashicorp/vault:1.20.2

USER root

COPY fix-perms.sh /usr/local/bin/fix-perms.sh
RUN chmod +x /usr/local/bin/fix-perms.sh

ENTRYPOINT ["/usr/local/bin/fix-perms.sh"]
