FROM python:3.14-slim-trixie

ARG USERNAME=vscode
ARG USER_UID=1000
ARG USER_GID=$USER_UID
ARG NODE_MAJOR=24
ARG POSTGRES_MAJOR=18

ENV TZ=America/New_York \
    DEBIAN_FRONTEND=noninteractive \
    LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8

# Base system utilities and terminal tools
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        bat \
        build-essential \
        ca-certificates \
        curl \
        fd-find \
        fzf \
        git \
        gnupg \
        htop \
        iproute2 \
        jq \
        less \
        locales \
        make \
        nano \
        net-tools \
        openssh-client \
        procps \
        ripgrep \
        sudo \
        tree \
        tzdata \
        unzip \
        vim \
        wget \
        zsh \
        zsh-autosuggestions \
        zsh-syntax-highlighting \
    && ln -s /usr/bin/batcat /usr/local/bin/bat \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd \
    && echo "en_US.UTF-8 UTF-8" > /etc/locale.gen \
    && locale-gen \
    && rm -rf /var/lib/apt/lists/*

# Node.js (LTS), GitHub CLI, and a psql client matching the server major version
RUN install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
        | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt trixie-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install --yes --no-install-recommends nodejs gh "postgresql-client-${POSTGRES_MAJOR}" \
    && rm -rf /var/lib/apt/lists/*

# uv (Python package manager), pinned via the image tag
COPY --from=ghcr.io/astral-sh/uv:0.12.21 /uv /uvx /usr/local/bin/

# Starship prompt and DigitalOcean CLI
ARG DOCTL_VERSION=1.175.0
RUN curl -fsSL https://starship.rs/install.sh | sh -s -- --yes --bin-dir /usr/local/bin \
    && arch="$(dpkg --print-architecture)" \
    && curl -fsSL "https://github.com/digitalocean/doctl/releases/download/v${DOCTL_VERSION}/doctl-${DOCTL_VERSION}-linux-${arch}.tar.gz" \
        | tar xz -C /usr/local/bin doctl

# Codex CLI (the VS Code extension bundles its own, this is for the terminal)
RUN npm install -g @openai/codex

# Non-root user, per https://code.visualstudio.com/remote/advancedcontainers/add-nonroot-user
RUN groupadd --gid $USER_GID $USERNAME \
    && useradd --uid $USER_UID --gid $USER_GID -m $USERNAME -s /usr/bin/zsh \
    && echo "$USERNAME ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

RUN git config --system core.editor "code --wait" \
    && git config --system safe.directory /workspace \
    && git config --system push.autoSetupRemote true \
    && git config --system init.defaultBranch main \
    && git config --system pull.rebase false \
    && git config --system core.autocrlf input

# Pre-create every directory that is backed by a named volume. Docker copies the
# image's ownership into a fresh volume, so these stay writable by $USERNAME.
RUN mkdir -p /commandhistory \
        /home/$USERNAME/.claude \
        /home/$USERNAME/.codex \
        /home/$USERNAME/.config/gh \
        /home/$USERNAME/.cache \
    && chown -R $USERNAME:$USERNAME /commandhistory /home/$USERNAME

USER $USERNAME
WORKDIR /workspace

# Claude Code CLI (native installer; the VS Code extension shares its config dir)
RUN curl -fsSL https://claude.ai/install.sh | bash

COPY --chown=$USERNAME:$USERNAME .devcontainer/zshrc /home/$USERNAME/.zshrc
COPY --chown=$USERNAME:$USERNAME .devcontainer/starship.toml /home/$USERNAME/.config/starship.toml

EXPOSE 3000 8000

CMD ["sleep", "infinity"]
