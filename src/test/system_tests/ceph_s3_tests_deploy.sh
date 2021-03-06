# #!/bin/bash
# DIRECTORY="s3-tests"
# CEPH_LINK="https://github.com/ceph/s3-tests.git"
# if [ ! -d $DIRECTORY ]; then
#     echo "Downloading Ceph S3 Tests..."
#     git clone $CEPH_LINK
#     echo "Finished Downloading Ceph S3 Tests"
# fi
# echo "Installing virtualenv using Yum..."
# yum install -y python-virtualenv
# #echo y
# echo "Finished Installing virtualenv"
# echo "Installing libxml2, libxslt..."
# #brew install libxml2
# #brew install libxslt
# #brew link libxml2 --force
# #brew link libxslt --force
# yum install -y libxml2
# yum install -y libxslt
# echo "Finished Installing libxml2, libxslt..."
# echo "Running Bootstrap..."
# cd $DIRECTORY
# ./bootstrap
#!/bin/bash
logger -p local0.info "ceph_s3_tests_deploy.sh executed."
DIRECTORY="s3-tests"
CEPH_LINK="https://github.com/ceph/s3-tests.git"
# using a fixed version (commit) of ceph tests to avoid sudden changes. 
# we should retest and update the version once in a while
CEPH_TESTS_VERSION=fa979f416da0a59950cf65215487631e530e6b18
if [ ! -d $DIRECTORY ]; then

    echo "Downloading Ceph S3 Tests..."
    logger -p local0.info "Downloading Ceph S3 Tests..."
    git clone $CEPH_LINK
    cd ${DIRECTORY}
    git checkout ${CEPH_TESTS_VERSION}
    echo "Finished Downloading Ceph S3 Tests"
    logger -p local0.info "Finished Downloading Ceph S3 Tests"

    if [ "$1" == "mac" ]; then
        echo "Installing python using brew..."
        logger -p local0.info "Installing python using brew..."
        brew install phyton
        echo "Finished Installing python"
        logger -p local0.info "Finished Installing python"

        echo "Installing virtualenv using pip..."
        logger -p local0.info "Installing virtualenv using pip..."
        pip install virtualenv
        echo "Finished Installing virtualenv"
        logger -p local0.info "Finished Installing virtualenv"

        echo "Installing virtualenvwrapper using pip..."
        logger -p local0.info "Installing virtualenvwrapper using pip..."
        pip install virtualenvwrapper
        source /usr/local/bin/virtualenvwrapper.sh
        echo "Finished Installing virtualenvwrapper"
        logger -p local0.info "Finished Installing virtualenvwrapper"
    else 
        echo "Remove centos-release-scl..."
        logger -p local0.info "Remove centos-release-scl..."
        yum -y remove centos-release-SCL

        echo "Install centos-release-scl..."
        logger -p local0.info "Install centos-release-scl..."
        yum -y install centos-release-scl
        echo "Finished Re-Installing centos-release-scl..."
        logger -p local0.info "Finished Re-Installing centos-release-scl..."

        echo "Erase new version of libevent-2..."
        logger -p local0.info "Erase new version of libevent-2..."
        yum -y erase libevent-2.0.21-2.el6.x86_64
        echo "Finished Erasing new version of libevent-2..."
        logger -p local0.info "Finished Erasing new version of libevent-2..."

        echo "Installing virtualenv using Yum..."
        logger -p local0.info "Installing virtualenv using Yum..."
        yum install -y python-virtualenv
        echo "Finished Installing virtualenv"
        logger -p local0.info "Finished Installing virtualenv"

        echo "Installing libxml2, libxslt..."
        logger -p local0.info "Installing libxml2, libxslt..."
        yum install -y libxml2
        yum install -y libxslt
        echo "Finished Installing libxml2, libxslt..."
        logger -p local0.info "Finished Installing libxml2, libxslt..."
    fi

    echo "Running Bootstrap..."
    logger -p local0.info "Running Bootstrap..."
    cd $DIRECTORY
    ./bootstrap
    touch ./s3tests/tests/__init__.py
    echo "Finished Running Bootstrap..."
    logger -p local0.info "Finished Running Bootstrap..."

fi