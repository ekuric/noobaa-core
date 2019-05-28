FROM noobaa/builder as base
WORKDIR /noobaa-core/

#####################################################################
# Layers:
#   Title: npm install (using package.json)
#   Size: ~ 825 MB
#   Cache: rebuild when ther is new package.json or package-lock.json
#####################################################################
COPY ./package*.json ./
RUN source /opt/rh/devtoolset-7/enable && \
    npm install
RUN echo 'PATH=$PATH:./node_modules/.bin' >> ~/.bashrc

##############################################################
# Layers:
#   Title: Building the native code
#   Size: ~ 10 MB
#   Cache: rebuild when Node.js there a change in the native 
#          directory or in the binding.gyp
##############################################################
COPY ./binding.gyp .
COPY ./src/native ./src/native/
RUN source /opt/rh/devtoolset-7/enable && \
    npm run build:native

##############################################################
# Layers:
#   Title: Copying the code and Building the frontend
#   Size: ~ 18 MB
#   Cache: rebuild when changing any file 
#          which is not excluded by .dockerignore 
##############################################################
COPY . ./
RUN source /opt/rh/devtoolset-7/enable && \
    npm run build:fe


##############################################################
# Layers:
#   Title: Setting the GIT Commit hash in the package.json
#   Size: ~ 0 MB
#   Cache: rebuild when using the --build-arg flag
#
# Setting GIT_COMMIT for the base
# In order to set it we need to run build with 
# --build-arg GIT_COMMIT=$(git rev-parse HEAD)
##############################################################
ARG GIT_COMMIT 
#RUN GIT_COMMIT=$(git rev-parse HEAD) && \
RUN current_version_line=$(grep version package.json) && \
    current_package_version=$(echo ${current_version_line} | awk -F '"' '{print $4}') && \
    sed -i "s/${current_version_line}/    \"version\": \"${current_package_version}-${GIT_COMMIT:0:7}\",/" package.json

FROM base as unitest

##############################################################
# Layers:
#   Title: installing unitest pre requirments
#   Size: ~ 262 MB
#   Cache: rebuild when we adding/removing requirments
##############################################################
ENV TEST_CONTAINER true
RUN yum install -y -q rh-mongodb36 && \
    yum install -y -q ntpdate && \ 
    yum clean all

##############################################################
# Layers:
#   Title: Setting some test env variables
#   Size: ~ 1 MB
#   Cache: rebuild when using the --build-arg flag
#
# Setting cloud cradentials for the tests
# In order to set those we need to run build with 
# --build-arg <arg_name>="<value>"
##############################################################

ARG aws_access_key_arg 
ARG aws_secret_access_key_arg
ARG azure_storage_arg
ARG test_name_arg
RUN mkdir -p /data/ && \
    echo 'ENDPOINT_BLOB_ENABLED=true' >> /data/.env && \
    echo 'DEV_MODE=true' >> /data/.env && \
    echo "TEST_RUN_NAME=$test_name_arg" >> /data/.env && \
    echo "AWS_ACCESS_KEY_ID=$aws_access_key_arg" >> /data/.env && \
    echo "AWS_SECRET_ACCESS_KEY=$aws_secret_access_key_arg" >> /data/.env && \
    echo "AZURE_STORAGE_CONNECTION_STRING=$azure_storage_arg" >> /data/.env 

CMD ["/bin/bash", "-c", "src/test/unit_tests/run_npm_test_on_test_container.sh"]
