#!/usr/bin/env bash
# Install the pinned uv, verifying its checksum.
#
# ONE home for the version, called by both `.github/workflows/ci.yml` and
# `.claude/hooks/session-start.sh`, in the shape of install-gitleaks.sh
# (python-uv-widened WS4). Before it, CI ran `python3 -m pip install
# uv==<pin>` -- the one bare interpreter check:python-uv had to exempt --
# and the session hook ran astral's unpinned install.sh only when no uv was
# present, so a container kept whatever uv it first fetched (0.11.32 against
# CI's 0.12.7) and both lanes resolved the same lock with different uvs.
#
# Pinned for the reason .nvmrc and .python-version are pinned: uv decides
# how uv.lock is read and synced, and the behaviours the Python rules rest
# on (`uv run` failing open with no project, `uv sync` re-locking) were read
# off a specific release. check:pins reads `uv --version` back against
# VERSION below, however that uv was installed. Keep VERSION on one line of
# its own: check:pins reads it with a regex.
#
# A third-party release tarball rather than a third-party GitHub Action or
# astral's install.sh: the workflow uses first-party `actions/*` only, and
# piping a script from the network runs code no digest covers. The digests
# are the ones published beside each tarball (uv-<target>.tar.gz.sha256)
# for this release.
set -euo pipefail

VERSION="0.12.7"

# shellcheck disable=SC2034  # each is read indirectly, by the digest_var
# lookup below; shellcheck cannot follow that.
SHA256_x86_64_unknown_linux_gnu="788f18abea7c5f55d6216e4f5613fd89d4d59b631efeec117b2b07fe72f1da21"
# shellcheck disable=SC2034
SHA256_aarch64_unknown_linux_gnu="66393193038dd7eb108abd7a218d9cec04ac70ab98242b0720fa94de19223b7c"
# shellcheck disable=SC2034
SHA256_x86_64_apple_darwin="06b8ae1da8c2661c5434507a66f8c2b0b835933bf955b5958a9ac357a37d1959"
# shellcheck disable=SC2034
SHA256_aarch64_apple_darwin="127ebdda7ad953cdf198e964b570ea5771b85467ea93eb7cb6d6f8e6f55408f3"

# Caller-chosen, as for gitleaks: the session hook and ci.yml both pass
# "${HOME}/.local/bin", which needs no privileges; ci.yml adds it to
# $GITHUB_PATH.
BIN_DIR="${1:-${HOME}/.local/bin}"
mkdir -p "${BIN_DIR}"

# Presence is read from BIN_DIR itself, never `command -v`: the first uv on
# PATH may be the cached one this script exists to replace, and a check
# that asked PATH would find it, see a uv, and leave the wrong one in place.
# uvx is banned (python-from-the-lockfile decision 2), and astral's own
# installer puts it beside uv; removed before the early exit, so a uv that
# is already at the pin does not keep a uvx next to it.
rm -f "${BIN_DIR}/uvx"

if [[ -x "${BIN_DIR}/uv" ]]; then
  have="$("${BIN_DIR}/uv" --version 2>/dev/null || echo unknown)"
  if [[ "${have}" == "uv ${VERSION}" || "${have}" == "uv ${VERSION} "* ]]; then
    echo "install-uv: ${VERSION} already present in ${BIN_DIR}."
    exit 0
  fi
  echo "install-uv: ${BIN_DIR}/uv is ${have}, pin is ${VERSION}; installing the pin." >&2
fi

# Assigned before they are tested. A command substitution inside `case` or
# `if` masks its own exit status (SC2312), so a uname that failed would be
# read as an unsupported platform rather than as a broken environment.
kernel="$(uname -s)"
machine="$(uname -m)"

case "${kernel}" in
  Linux) os="unknown-linux-gnu" ;;
  Darwin) os="apple-darwin" ;;
  *)
    echo "install-uv: unsupported OS ${kernel}." >&2
    echo "  Install uv ${VERSION} by hand: https://github.com/astral-sh/uv/releases/tag/${VERSION}" >&2
    exit 2
    ;;
esac

case "${machine}" in
  x86_64 | amd64) arch="x86_64" ;;
  arm64 | aarch64) arch="aarch64" ;;
  *)
    echo "install-uv: unsupported architecture ${machine}." >&2
    exit 2
    ;;
esac

target="${arch}-${os}"
# Indirect expansion, so the digest table above stays a flat list of
# platform-keyed constants rather than a case statement repeating the names.
digest_var="SHA256_${target//-/_}"
digest="${!digest_var:-}"
if [[ -z "${digest}" ]]; then
  echo "install-uv: no pinned digest for ${target}." >&2
  exit 2
fi

tarball="uv-${target}.tar.gz"
url="https://github.com/astral-sh/uv/releases/download/${VERSION}/${tarball}"

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

if ! curl -fsSL -o "${tmp}/${tarball}" "${url}"; then
  echo "install-uv: could not download ${url}" >&2
  exit 2
fi

# Verified BEFORE it is unpacked, not after: unpacking runs no code, but the
# point of a digest is that nothing downstream ever sees unverified bytes.
# sha256sum on Linux, shasum -a 256 on macOS, which ships no sha256sum;
# without either the script refuses by name rather than dying on a bare
# "command not found" under set -e.
if command -v sha256sum >/dev/null 2>&1; then
  sha() { sha256sum "$@"; }
elif command -v shasum >/dev/null 2>&1; then
  sha() { shasum -a 256 "$@"; }
else
  echo "install-uv: neither sha256sum nor shasum is available, so the download cannot be verified." >&2
  exit 2
fi
actual="$(sha "${tmp}/${tarball}" | cut -d' ' -f1)"
if [[ "${actual}" != "${digest}" ]]; then
  echo "install-uv: CHECKSUM MISMATCH for ${tarball}." >&2
  echo "  Expected ${digest}" >&2
  echo "  Got      ${actual}" >&2
  echo "  Refusing to install. Do not work around this." >&2
  exit 2
fi

# uv only: the tarball also carries uvx, which python-from-the-lockfile
# decision 2 bans, so it is neither unpacked nor installed.
tar -xzf "${tmp}/${tarball}" -C "${tmp}" "uv-${target}/uv"
install -m 0755 "${tmp}/uv-${target}/uv" "${BIN_DIR}/uv"

# By absolute path, NOT through PATH: BIN_DIR may not be on PATH yet (the
# CI case), and an older uv earlier on PATH would answer for it. Anything
# but the pin is a failed install, not a success with a footnote.
installed="$("${BIN_DIR}/uv" --version 2>/dev/null || echo unknown)"
if [[ "${installed}" != "uv ${VERSION}" && "${installed}" != "uv ${VERSION} "* ]]; then
  echo "install-uv: ${BIN_DIR}/uv reports ${installed} after installing ${VERSION}." >&2
  exit 2
fi
echo "install-uv: installed ${installed} to ${BIN_DIR}."
