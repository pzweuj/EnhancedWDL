version 2.0

task BaseTask {
    input {
        String base_input
        Int? multiplier = 1
    }
    
    command <<<
        echo "Base processing: ~{base_input} * ~{multiplier}"
    >>>
    
    output {
        String base_output = "processed_" + base_input
        Int result_count = multiplier
    }
    
    runtime {
        container: "ubuntu:20.04"
        cpu: 1
        memory: "512MB"
    }
}