DOCKER	:= docker
COMPOSE	:= $(DOCKER) compose

BOLD	= \033[1m
GREEN	= \033[1;32m
RESET	= \033[0m

all: up

# VERSION EVAL
# up:
# 	@echo "$(GREEN)>> Starting...$(RESET)"
# 	$(COMPOSE) up -d --build

# VERSION DEV
up: down
	@echo "$(GREEN)>> Starting...$(RESET)"
	$(COMPOSE) up -d --build

frontend-up:
	@echo "$(GREEN)>> Starting frontend...$(RESET)"
	$(COMPOSE) up -d --build frontend

backend-up:
	@echo "$(GREEN)>> Starting backend...$(RESET)"
	$(COMPOSE) up -d --build backend

down:
	$(COMPOSE) down

re: down up

logs:
	@ if [ -z "$(c)" ]; then \
		$(COMPOSE) logs; \
	else \
		$(COMPOSE) logs $(c); \
	fi

ps:
	$(COMPOSE) ps

ps-a:
	$(COMPOSE) ps -a

ls:
	$(COMPOSE) ls

ls-a:
	$(COMPOSE) ls -a

vol-ls:
	$(DOCKER) volume ls

exec:
	@ if [ -z "$(c)" ]; then \
		echo "Error: you must specify the container name with c=<name>"; \
		exit 1; \
	fi; \
	state=$$($(DOCKER) inspect -f '{{.State.Status}}' $(c) 2>/dev/null); \
	if [ -z "$$state" ]; then \
		echo "Error: container '$(c)' does not exist."; \
		exit 1; \
	fi; \
	if [ "$$state" != "running" ] && [ "$$state" != "exited" ]; then \
		echo "Error: container '$(c)' must be in 'running' or 'exited' state (current: $$state)."; \
		exit 1; \
	fi
	$(DOCKER) exec -it $(c) sh

help:
	@echo ""
	@echo "$(GREEN)Available targets:$(RESET)"
	@echo "$(BOLD)all (up)         $(RESET): Start all services (default)"
	@echo "$(BOLD)down             $(RESET): Stop all services"
	@echo "$(BOLD)re               $(RESET): Restart all services"
	@echo "$(BOLD)logs             $(RESET): View logs (use 'c=<name>' to filter by service)"
	@echo "$(BOLD)ps               $(RESET): List running containers"
	@echo "$(BOLD)ps-a             $(RESET): List all containers"
	@echo "$(BOLD)ls               $(RESET): List compose projects"
	@echo "$(BOLD)exec c=<name>    $(RESET): Open an interactive sh shell in the specified container"
	@echo ""

help-dev:
	@echo ""
	@echo "$(GREEN)Available targets:$(RESET)"
	@echo "$(BOLD)all (up)         $(RESET): Start all services (default)"
	@echo "$(BOLD)frontend-up      $(RESET): Start only the frontend service"
	@echo "$(BOLD)backend-up       $(RESET): Start only the backend service"
	@echo "$(BOLD)down             $(RESET): Stop all services"
	@echo "$(BOLD)re               $(RESET): Restart all services"
	@echo "$(BOLD)logs             $(RESET): View logs (use 'c=<name>' to filter by service)"
	@echo "$(BOLD)ps               $(RESET): List running containers"
	@echo "$(BOLD)ps-a             $(RESET): List all containers"
	@echo "$(BOLD)ls               $(RESET): List compose projects"
	@echo "$(BOLD)exec c=<name>    $(RESET): Open an interactive sh shell in the specified container"
	@echo "$(BOLD)fclean           $(RESET): Remove all Docker volumes and images"
	@echo "$(BOLD)prune            $(RESET): Prune Docker builder cache"
	@echo ""

fclean: clean-volumes clean-images

clean-volumes:
	@vols=$$($(DOCKER) volume ls -q); \
	if [ -z "$$vols" ]; then \
		echo "✅ No volumes to remove."; \
	else \
		read -p "⚠️  Remove ALL Docker volumes? (y/n) " ans; \
		if [ "$$ans" = "y" ]; then \
			echo "🗑️ Removing volumes..."; \
			$(COMPOSE) down; \
			$(DOCKER) volume rm $$vols; \
		else \
			echo "❌ Cancelled."; \
		fi; \
	fi

clean-images:
	@imgs=$$($(DOCKER) images -aq); \
	if [ -z "$$imgs" ]; then \
		echo "✅ No images to remove."; \
	else \
		echo ""; \
		read -p "⚠️  Remove ALL Docker images? (y/n) " ans; \
		if [ "$$ans" = "y" ]; then \
			echo "🗑️ Removing images..."; \
			$(COMPOSE) down; \
			$(DOCKER) rmi -f $$imgs; \
		else \
			echo "❌ Cancelled."; \
		fi; \
	fi

prune:
	@read -p "⚠️  Are you sure? (y/n) " ans; \
	if [ "$$ans" = "y" ]; then \
		echo ""; \
		echo "🗑️ Removing..."; \
		$(DOCKER) builder prune -f; \
	else \
		echo "❌ Cancelled."; \
	fi; \

.PHONY: all up frontend-up backend-up down re logs ps ps-a ls ls-a vol-ls	\
		exec help help-dev fclean clean-volumes clean-images prune			\
