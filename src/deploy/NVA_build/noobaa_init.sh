#!/bin/bash

echo "running fix_server_plat"
/root/node_modules/noobaa-core/src/deploy/NVA_build/fix_server_plat.sh
echo "fix_mongo_ssl"
/root/node_modules/noobaa-core/src/deploy/NVA_build/fix_mongo_ssl.sh
echo "running get_docker_variables"
/root/node_modules/noobaa-core/src/deploy/NVA_build/get_docker_variables.sh

echo "starting all services"
supervisorctl start all

exit 0