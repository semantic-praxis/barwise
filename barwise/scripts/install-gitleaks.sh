#!/usr/bin/env bash
# Install the pinned gitleaks, verifying its checksum.
#
# ONE home for the version, called by both `.github/workflows/ci.yml` and
# `.claude/hooks/session-start.sh`. A copy of the version and digest in each
# would be a must-agree pair with nothing checking it, which CLAUDE.md
# forbids -- and the failure would be quiet: CI and a developer's pre-push
# run would apply different rule sets to the same diff and disagree about
# whether it is clean.
#
# Pinned rather than floated for the reason .nvmrc and .python-version are
# pinned. gitleaks ships rules, so the version decides which secrets are
# found; an unpinned install makes the gate's verdict depend on whichever
# release the machine happened to fetch. The digests are the ones published
# in gitleaks_<version>_checksums.txt for this release.
#
# A third-party release tarball rather than a third-party GitHub Action: the
# workflow uses first-party `actions/*` only, and the supply-chain spec left
# widening that out of scope. A pinned tarball with a verified digest is the
# same shape as `pip install uv==0.12.7` already in that workflow.
set -euo pipefail

VERSION="8.28.0"

# shellcheck disable=SC2034  # each is read indirectly, by the digest_var
# lookup below; shellcheck cannot follow that.
SHA256_linux_x64="a65b5253807a68ac0cafa4414031fd740aeb55f54fb7e55f386acb52e6a840eb"
# shellcheck disable=SC2034
SHA256_linux_arm64="eff65261156100e5d94a6b3dec313d532fddfe19ae1590bf7a2b4f2699128356"
# shellcheck disable=SC2034
SHA256_darwin_arm64="d942f3ad147250c9edbaab3fed9e482f98d3b59ba10ae97b8d75647e3ade492c"
# shellcheck disable=SC2034
SHA256_darwin_x64="edf5a507008b0d2ef4959575772772770586409c1f6f74dabf19cbe7ec341ced"

# Caller-chosen, because "somewhere on PATH" is not the same question on a
# root container as on a hosted CI runner: the session hook takes the default,
# while ci.yml passes a directory under $HOME that needs no privileges and
# adds it to $GITHUB_PATH.
BIN_DIR="${1:-/usr/local/bin}"
mkdir -p "${BIN_DIR}"

if command -v gitleaks >/dev/null 2>&1; then
  have="$(gitleaks version 2>/dev/null || echo unknown)"
  if [[ "${have}" == "${VERSION}" ]]; then
    echo "install-gitleaks: ${VERSION} already present."
    exit 0
  fi
  # Not an error: a developer may have installed it from a package manager.
  # The gate prints the version it used, so a reading stays attributable.
  echo "install-gitleaks: gitleaks ${have} present, pin is ${VERSION}; installing the pin." >&2
fi

# Assigned before they are tested. A command substitution inside `case` or
# `if` masks its own exit status (SC2312), so a uname that failed would be
# read as an unsupported platform rather than as a broken environment.
kernel="$(uname -s)"
machine="$(uname -m)"

case "${kernel}" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *)
    echo "install-gitleaks: unsupported OS ${kernel}." >&2
    echo "  Install gitleaks ${VERSION} by hand: https://github.com/gitleaks/gitleaks" >&2
    exit 2
    ;;
esac

case "${machine}" in
  x86_64 | amd64) arch="x64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *)
    echo "install-gitleaks: unsupported architecture ${machine}." >&2
    exit 2
    ;;
esac

# Indirect expansion, so the digest table above stays a flat list of
# platform-keyed constants rather than a case statement repeating the names.
digest_var="SHA256_${os}_${arch}"
digest="${!digest_var:-}"
if [[ -z "${digest}" ]]; then
  echo "install-gitleaks: no pinned digest for ${os}_${arch}." >&2
  exit 2
fi

tarball="gitleaks_${VERSION}_${os}_${arch}.tar.gz"
url="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${tarball}"

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

if ! curl -fsSL -o "${tmp}/${tarball}" "${url}"; then
  echo "install-gitleaks: could not download ${url}" >&2
  exit 2
fi

# Verified BEFORE it is unpacked, not after: unpacking runs no code, but the
# point of a digest is that nothing downstream ever sees unverified bytes.
if ! echo "${digest}  ${tmp}/${tarball}" | sha256sum -c - >/dev/null 2>&1; then
  actual="$(sha256sum "${tmp}/${tarball}" | cut -d' ' -f1)"
  echo "install-gitleaks: CHECKSUM MISMATCH for ${tarball}." >&2
  echo "  Expected ${digest}" >&2
  echo "  Got      ${actual}" >&2
  echo "  Refusing to install. Do not work around this." >&2
  exit 2
fi

tar -xzf "${tmp}/${tarball}" -C "${tmp}" gitleaks
install -m 0755 "${tmp}/gitleaks" "${BIN_DIR}/gitleaks"
# By absolute path, NOT through PATH. When BIN_DIR is not on PATH -- which is
# exactly the CI case, where $GITHUB_PATH is updated by the caller afterwards
# -- a bare `gitleaks version` here exits 127 and fails the step on a
# successful install.
installed="$("${BIN_DIR}/gitleaks" version)"
echo "install-gitleaks: installed ${installed} to ${BIN_DIR}."
