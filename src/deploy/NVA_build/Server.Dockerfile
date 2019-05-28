FROM noobaa/builder as server_builder

COPY ./package*.json ./
ARG GIT_COMMIT 
RUN if [ "${GIT_COMMIT}" != "" ]; then sed -i 's/^  "version": "\(.*\)",$/  "version": "\1-'${GIT_COMMIT:0:7}'",/' package.json; fi

RUN source /opt/rh/devtoolset-7/enable && \
    npm install

COPY ./binding.gyp .
COPY ./src/native ./src/native/
RUN source /opt/rh/devtoolset-7/enable && \
    npm run build:native

COPY ./.nvmrc ./.nvmrc
RUN mkdir -p build/public/ && \
    NODEJS_VERSION=v$(cat ./.nvmrc) && \
    echo "$(date) =====> download node.js tarball ($NODEJS_VERSION) and nvm.sh (latest)" && \
    wget -P build/public/ https://nodejs.org/dist/${NODEJS_VERSION}/node-${NODEJS_VERSION}-linux-x64.tar.xz && \
    wget -P build/public/ https://raw.githubusercontent.com/creationix/nvm/master/nvm.sh 

COPY ./frontend/ ./frontend/
COPY ./images/ ./images/
COPY ./src/rpc/ ./src/rpc/
COPY ./src/api/ ./src/api/
COPY ./src/util/ ./src/util/
COPY ./config.js ./
RUN source /opt/rh/devtoolset-7/enable && \
    npm run build:fe

COPY . ./

RUN tar \
    --transform='s:^:noobaa-core/:' \
    --exclude='src/native/aws-cpp-sdk' \
    --exclude='src/native/third_party' \
    -czf noobaa-NVA.tar.gz \
    LICENSE \
    package.json \
    platform_restrictions.json \
    config.js \
    .nvmrc \
    src/ \
    frontend/dist/ \
    build/public/ \
    build/Release/ \
    node_modules/ 

###############################################################################
###############################################################################
###############################################################################

FROM centos:7

ENV container docker
COPY ./src/deploy/rpm/set_mongo_repo.sh /tmp/
RUN chmod +x /tmp/set_mongo_repo.sh && \
    /bin/bash -xc "/tmp/set_mongo_repo.sh"
RUN yum install -y bash \
    bind-utils-32:9.9.4 \
    bind-32:9.9.4 \
    tcpdump-14:4.9.2 \
    cronie-1.4.11 \
    initscripts-9.49.46 \
    lsof-4.87 \
    net-tools-2.0 \
    openssh-server-7.4p1 \
    rng-tools-6.3.1 \
    rsyslog-8.24.0 \
    strace-4.12 \
    sudo-1.8.23 \
    wget-1.14 \
    dialog-1.2 \
    expect-5.45 \
    iperf3-3.1.7 \
    iptables-services-1.4.21 \
    curl-7.29.0 \
    ntp-4.2.6p5 \
    nc \
    vim \
    less \
    bash-completion \
    python-setuptools-0.9.8 \
    mongodb-org-3.6.3 \
    mongodb-org-server-3.6.3 \
    mongodb-org-shell-3.6.3 \
    mongodb-org-mongos-3.6.3 \
    mongodb-org-tools-3.6.3 && \
    yum clean all


COPY --from=server_builder /noobaa/noobaa-NVA.tar.gz /tmp/
COPY --from=server_builder /noobaa/src/deploy/NVA_build/deploy_base.sh /usr/bin/deploy_base.sh
RUN /usr/bin/deploy_base.sh runinstall
RUN mkdir -m 775 /noobaa_init_files/ && \
    chgrp -R 0 /noobaa_init_files/ && \
    chmod -R g=u /noobaa_init_files/ && \
    cp -p /root/node_modules/noobaa-core/src/deploy/NVA_build/noobaa_init.sh /noobaa_init_files/  && \
    cp -p /root/node_modules/noobaa-core/build/Release/kube_pv_chown /noobaa_init_files/  && \
    rm -rf /root/node_modules/noobaa-core/

###############
# PORTS SETUP #
###############
EXPOSE 60100
EXPOSE 80
EXPOSE 443
EXPOSE 8080
EXPOSE 8443
EXPOSE 8444
EXPOSE 27000
EXPOSE 26050

###############
# EXEC SETUP #
###############
# run as non root user that belongs to root 
USER 10001:0
CMD ["/usr/bin/supervisord", "start_container"]
