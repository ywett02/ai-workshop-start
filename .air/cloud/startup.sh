#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
repo_dir=$PWD
node_version=24.13.0
case "$(uname -m)" in
  x86_64) node_arch=x64 ;;
  aarch64|arm64) node_arch=arm64 ;;
  *) echo 'Unsupported Node.js architecture' >&2; exit 1 ;;
esac
node_name="node-v${node_version}-linux-${node_arch}"
tool_dir="$HOME/.local/share/air"
node_home="$tool_dir/$node_name"

if [ ! -x "$node_home/bin/node" ]; then
  echo "Installing Node.js $node_version ($node_arch)..."
  mkdir -p "$tool_dir"
  download_dir=$(mktemp -d "$tool_dir/node-download.XXXXXX")
  trap 'rm -rf "$download_dir"' EXIT
  # curl honors HTTPS_PROXY; all downloads use the environment's egress proxy.
  curl -fsSL "https://nodejs.org/dist/v${node_version}/${node_name}.tar.gz" -o "$download_dir/${node_name}.tar.gz"
  curl -fsSL "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" -o "$download_dir/SHASUMS256.txt"
  (cd "$download_dir"; grep " ${node_name}.tar.gz$" SHASUMS256.txt | sha256sum -c -)
  tar -xzf "$download_dir/${node_name}.tar.gz" -C "$tool_dir"
  rm -rf "$download_dir"
  trap - EXIT
fi

# Startup runs as a child process. Persist the runtime for agent login shells.
mkdir -p "$HOME/.config/air"
shell_env="$HOME/.config/air/skill-atlas-env.sh"
printf 'export PATH=%q/bin:"$PATH"\nexport NODE_USE_ENV_PROXY=1\n' "$node_home" > "$shell_env"
source "$shell_env"
source_line='[ ! -f "$HOME/.config/air/skill-atlas-env.sh" ] || . "$HOME/.config/air/skill-atlas-env.sh" # air-skill-atlas'
login_profile="$HOME/.profile"
for candidate in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
  if [ -f "$candidate" ]; then login_profile=$candidate; break; fi
done
for profile in "$login_profile" "$HOME/.bashrc"; do
  if ! grep -Fq '# air-skill-atlas' "$profile" 2>/dev/null; then
    printf '\n%s\n' "$source_line" >> "$profile"
  fi
done

node --version
npm --version
# Keep snapshot dependencies on task boot; reinstall when the manifest changes.
dependency_stamp=$(cat package.json package-lock.json | sha256sum | cut -d ' ' -f 1)
stamp_file=node_modules/.air-dependency-stamp
if [ ! -f "$stamp_file" ] || [ "$(cat "$stamp_file")" != "$node_version:$dependency_stamp" ] || [ ! -x node_modules/.bin/tsc ]; then
  echo 'Installing locked npm dependencies...'
  npm ci --no-audit --no-fund
  printf '%s\n' "$node_version:$dependency_stamp" > "$stamp_file"
else
  echo 'Using cached npm dependencies.'
fi

healthcheck() {
  # This CLI has no service to poll: exercise the same checks as repository CI.
  cd "$repo_dir"
  echo 'Checking TypeScript, integration tests, and the real CLI...'
  npm run typecheck || return $?
  npm test || return $?
  ./skill-atlas help || return $?
  ./skill-atlas scan ./fixture || return $?
  echo 'Skill Atlas environment is ready.'
}

if [ "${AIR_STARTUP_MODE:-}" = warmup ]; then
  healthcheck
fi
