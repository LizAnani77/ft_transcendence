# Dockerfile pour OWASP ModSecurity Core Rule Set avec Nginx
FROM owasp/modsecurity-crs:nginx

USER root

RUN groupmod -g 1000 nginx && \
    usermod -u 1000 nginx

RUN mkdir -p /docker-entrypoint.d.disabled && \
    mv /docker-entrypoint.d/* /docker-entrypoint.d.disabled/ 2>/dev/null || true

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/modsecurity/ /etc/modsecurity.d/

COPY nginx/wait-for-tls.sh /usr/local/bin/wait-for-tls.sh
RUN chmod +x /usr/local/bin/wait-for-tls.sh

RUN mkdir -p /tmp /var/cache/nginx /etc/nginx/ssl && \
    chown -R 1000:1000 /tmp /var/cache/nginx /etc/nginx /etc/modsecurity.d /etc/nginx/ssl && \
    chmod -R 775 /tmp /var/cache/nginx && \
    chmod -R 755 /etc/nginx /etc/modsecurity.d

USER 1000

ENTRYPOINT ["/usr/local/bin/wait-for-tls.sh"]
