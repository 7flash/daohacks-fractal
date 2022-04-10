#!/bin/sh

# FIXME: Cannot use set -e since bash is not installed in Dockerfile
# set -e

RETRIES=${RETRIES:-40}
VERBOSITY=${VERBOSITY:-6}

if [[ ! -z "$URL" ]]; then
    # get the addrs from the URL provided
    ADDRESSES=$(curl --fail --show-error --silent --retry-connrefused --retry $RETRIES --retry-delay 5 $URL)

    function envSet() {
        VAR=$1
        export $VAR=$(echo $ADDRESSES | jq -r ".$2")
    }

    # set all the necessary env vars
    envSet ETH1_ADDRESS_RESOLVER_ADDRESS  AddressManager
    envSet ETH1_L1_CROSS_DOMAIN_MESSENGER_ADDRESS Proxy__OVM_L1CrossDomainMessenger
    envSet ROLLUP_ADDRESS_MANAGER_OWNER_ADDRESS Deployer

    # set the address to the proxy gateway if possible
    envSet ETH1_L1_ETH_GATEWAY_ADDRESS Proxy__OVM_L1ETHGateway
    if [ $ETH1_L1_ETH_GATEWAY_ADDRESS == null ]; then
        envSet ETH1_L1_ETH_GATEWAY_ADDRESS OVM_L1ETHGateway
    fi
fi

# wait for the dtl to be up, else geth will crash if it cannot connect
curl \
    --fail \
    --show-error \
    --silent \
    --output /dev/null \
    --retry-connrefused \
    --retry $RETRIES \
    --retry-delay 1 \
    $ROLLUP_CLIENT_HTTP

exec geth --verbosity="$VERBOSITY" "$@"
