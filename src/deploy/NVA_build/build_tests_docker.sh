#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}@${BASH_SOURCE}:${LINENO} \e[0m'

command="docker"
name="nbtests"

short_options="h,p,n:,t:,k:,s:"
long_options="help,podman,name:,tag:,aws_access_key:,aws_secret_access_key:"

OPTIONS=$( getopt -o 'h,p,n:,t:,k:,s:' --long "${long_options}" -- "$@" )
eval set -- "${OPTIONS}"

function usage(){
    echo "$0 [options]"
    echo "-p --podman                   -   Will use podman instead of docker"
    echo "-n --name                     -   Set the image name (default: ${name})"
    echo "-t --tag                      -   Set a tag for the image"
    echo "-k --aws_access_key           -   Set aws_access_key"
    echo "-s --aws_secret_access_key    -   Set aws_secret_access_key"
    echo "-h --help                     -   Will show this help"
    exit 0
}

while true
do
    case ${1} in
        -p|--podman)                command="podman";
                                    shift 1;;
        -n|--name)                  name=${2};
                                    shift 2;;
        -t|--tag)                   tag=${2};
                                    shift 2;;
        -k|--aws_access_key)        aws_access_key_arg=${2};
                                    shift 2;;
        -s|--aws_secret_access_key) aws_secret_access_key_arg=${2};
                                    shift 2;;
		-h|--help)                  usage;;
		--)                         shift 1;
		                            break ;;
    esac
done

dockerfile="src/deploy/NVA_build/Tests.Dockerfile"

if [ ! -z ${tag} ] ; then
    name=${name}:${tag}
fi

command_build="${command} build"

if [ ! -z ${aws_access_key_arg} ] ; then
    command_build="${command_build} --build-arg aws_access_key_arg=\"${aws_access_key_arg}\""
fi

if [ ! -z ${aws_secret_access_key_arg} ] ; then
    command_build="${command_build} --build-arg aws_secret_access_key_arg=\"${aws_secret_access_key_arg}\""
fi

echo "Building: ${command_build} -f ${dockerfile} -t ${name} --rm ./"
${command_build} -f ${dockerfile} -t ${name} --rm ./ || exit 1