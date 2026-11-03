FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl ca-certificates jq openssl unzip sudo \
 && mkdir -p -m 755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code
ENV BUN_INSTALL=/usr/local
RUN curl -fsSL https://bun.sh/install | bash
# The node image already has uid 1000 (user node). Rename it to runner.
# The agent runs as uid 1001 (user agent). It shares the group wardenwork with the runner,
# so it can write only the checkout and the state directory of one run.
RUN usermod -l runner -d /home/runner -m node && groupmod -n runner node \
 && groupadd -g 1001 agent && useradd -u 1001 -g agent -m -d /home/agent -s /bin/bash agent \
 && groupadd wardenwork && usermod -aG wardenwork runner && usermod -aG wardenwork agent \
 && printf '[safe]\n\tdirectory = *\n' > /home/agent/.gitconfig && chown agent:agent /home/agent/.gitconfig \
 && chmod 700 /home/runner /home/agent \
 && mkdir -p /state /work /inbox /tests-in/work /tests-in/queue /tests-out/results /tests-out/done \
 && mkdir -p -m 700 /secrets /run/warden \
 && chown runner:runner /inbox /secrets /tests-in /tests-in/work /tests-in/queue \
 && chown -R agent:agent /tests-out && chmod -R 755 /tests-out /tests-in \
 && chown runner:wardenwork /state /work /run/warden && chmod 710 /state /work /run/warden \
 && chmod 700 /inbox \
 && printf 'runner ALL=(agent) NOPASSWD:SETENV: /app/bin/agent-exec.sh\nDefaults!/app/bin/agent-unlock.sh env_reset\nrunner ALL=(agent) NOPASSWD: /app/bin/agent-unlock.sh *\n' > /etc/sudoers.d/warden \
 && chmod 0440 /etc/sudoers.d/warden && visudo -c
# The code is owned by root. The runner and the agent cannot change it.
COPY . /app
RUN chown -R root:root /app && chmod -R go-w /app && chmod 755 /app/bin/*.sh
WORKDIR /app
USER runner
ENV STATE_ROOT=/state WORK_ROOT=/work TESTS_IN=/tests-in TESTS_OUT=/tests-out
CMD ["bin/run-all.sh"]
