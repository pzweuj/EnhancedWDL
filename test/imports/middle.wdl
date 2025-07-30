version 2.0

import "./base.wdl" as base

task MiddleTask {
    input {
        String middle_input
        Boolean use_base = true
    }
    
    command <<<
        if [ "~{use_base}" = "true" ]; then
            echo "Middle task using base: ~{middle_input}"
        else
            echo "Middle task standalone: ~{middle_input}"
        fi
    >>>
    
    output {
        String middle_output = "middle_" + middle_input
        Boolean processed = true
    }
    
    runtime {
        container: "ubuntu:20.04"
        cpu: 1
        memory: "512MB"
    }
}