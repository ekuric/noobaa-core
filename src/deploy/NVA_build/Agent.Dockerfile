FROM noobaa/builder as base

COPY ./package*.json ./
ARG GIT_COMMIT 
RUN if [ "${GIT_COMMIT}" != "" ]; then sed -i 's/^  "version": "\(.*\)",$/  "version": "\1-'${GIT_COMMIT:0:7}'",/' package.json; fi

COPY src/deploy/NVA_build/fix_package_json.sh ./

# remove irrelevant packages
RUN sed -i '/babel/d' package.json && \
    sed -i '/gulp/d' package.json && \
    sed -i '/mocha/d' package.json && \
    sed -i '/nyc/d' package.json && \
    sed -i '/istanbul/d' package.json && \
    sed -i '/eslint/d' package.json && \
    sed -i '/phantomjs/d' package.json && \
    sed -i '/selenium/d' package.json && \
    sed -i '/vsphere/d' package.json
RUN ./fix_package_json.sh && \ 
    npm install --production && \
    npm install node-linux@0.1.8

COPY ./binding.gyp .
COPY ./src/native ./src/native/
RUN npm run build:native

COPY . ../noobaa-core/

RUN cp ../noobaa-core/LICENSE . && \
    cp ../noobaa-core/config.js . && \
    cp ../noobaa-core/src/deploy/Linux/noobaa_service_installer.sh . && \
    cp ../noobaa-core/src/deploy/Linux/uninstall_noobaa_agent.sh . && \
    cp ../noobaa-core/src/deploy/Linux/remove_service.sh . && \
    # cp $(nvm which current) . && \
    cp -R ../noobaa-core/src/s3 src/ && \
    cp -R ../noobaa-core/src/sdk src/ && \
    cp -R ../noobaa-core/src/endpoint src/ && \
    cp -R ../noobaa-core/src/agent src/ && \
    cp -R ../noobaa-core/src/rpc src/ && \
    cp -R ../noobaa-core/src/api src/ && \
    cp -R ../noobaa-core/src/util src/ && \
    cp -R ../noobaa-core/src/tools src/ && \
    rm -rf agent_conf.json src/native fix_package_json.sh

# FROM centos:7 as base

# RUN yum -y install epel-release openssl && \
#     yum clean all

# FROM base as basenoobaa

FROM centos:7 

ENV container docker
WORKDIR /noobaa
RUN mkdir -p /noobaa_storage

COPY --from=base /noobaa/ /noobaa/



###########################
# NOOBAA AGENT BASE SETUP #
###########################

# ARG noobaa_agent_package=./noobaa-setup
# ARG agent_entrypoint=./run_agent_container.sh
# COPY ${noobaa_agent_package} .
# COPY ${agent_entrypoint} .
# RUN chmod +x run_agent_container.sh
# RUN chmod +x noobaa-setup
# This is a dummy token in order to perform the installation
# RUN ./noobaa-setup JZ-
# RUN tar -zcf noobaa.tar.gz /usr/local/noobaa/

######################################################
# FROM base
# LABEL maintainer="Liran Mauda (lmauda@redhat.com)"

################
# NOOBAA SETUP #
################
# ENV container docker
# RUN mkdir /noobaa_storage
# ARG agent_entrypoint=./run_agent_container.sh
# ARG kube_pv_chown=./usr/local/noobaa/build/Release/kube_pv_chown
ARG kube_pv_chown=/noobaa/build/Release/kube_pv_chown
RUN chgrp 0 /etc/passwd && chmod -R g=u /etc/passwd && \
    chmod u+s /usr/bin/tar
# COPY --from=basenoobaa ${kube_pv_chown} ./bin/
# COPY --from=basenoobaa ${agent_entrypoint} .
# COPY --from=basenoobaa ./noobaa.tar.gz .

###############
# PORTS SETUP #
###############
EXPOSE 60101-60600

###############
# EXEC SETUP #
###############
# run as non root user that belongs to root group
USER 10001:0
ENTRYPOINT ["./src/deploy/NVA_build/run_agent_container.sh"]