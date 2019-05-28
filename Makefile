all: builder tester server agent
	echo "All done."

builder:	
	docker build -f src/deploy/NVA_build/builder.Dockerfile -t noobaa/builder .
	echo "Builder done."

tests: builder	
	docker build -f src/deploy/NVA_build/Tests.Dockerfile -t noobaa/tester .
	echo "Tester done."

server: builder		
	docker build -f src/deploy/NVA_build/Server.Dockerfile -t noobaa/server --build-arg GIT_COMMIT="$(shell git rev-parse HEAD)" .
	echo "Server done."

agent: builder	
	docker build -f src/deploy/NVA_build/Agent.Dockerfile -t noobaa/agent --build-arg GIT_COMMIT="$(shell git rev-parse HEAD)" .
	echo "Agent done."
