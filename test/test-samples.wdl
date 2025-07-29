version 2.0
# Test file for WDL syntax highlighting

import "./tasks/struct.wdl"
import "./tasks/qc.wdl" as qc

workflow TestWorkflow {
    input {
        String sample_id
        File input_file
        Array[String] samples
        Map[String, Int] config
        Boolean debug = false
        Int? optional_param
    }

    # Test string interpolation
    String output_path = "~{sample_id}/results"
    String command_str = "${sample_id}.output"
    
    # Test conditional logic
    if (debug) {
        call DebugTask {
            input: sample=sample_id
        }
    }
    
    # Test scatter
    scatter (sample in samples) {
        call ProcessSample {
            input: 
                sample_name=sample,
                input_file=input_file
        }
    }
    
    # Test call with alias
    call qc.QualityControl as QC {
        input: file=input_file
    }
    
    output {
        Array[File] results = ProcessSample.output_file
        File? debug_output = DebugTask.debug_file
    }
}

task ProcessSample {
    input {
        String sample_name
        File input_file
        Int cpu_count = 4
        Float memory_gb = 8.0
    }
    
    command <<<
        # Shell command with variable interpolation
        echo "Processing sample: ~{sample_name}"
        
        if [ -f "~{input_file}" ]; then
            echo "Input file exists"
            cat ~{input_file} > ~{sample_name}.processed
        else
            echo "Error: Input file not found" >&2
            exit 1
        fi
        
        # Test various shell constructs
        for i in {1..10}; do
            echo "Processing iteration $i"
        done
    >>>
    
    output {
        File output_file = "~{sample_name}.processed"
    }
    
    runtime {
        container: "ubuntu:20.04"
        cpu: cpu_count
        memory: "~{memory_gb}GB"
        disk: "10GB"
    }
    
    meta {
        description: "Process a single sample"
        author: "Test Author"
    }
    
    parameter_meta {
        sample_name: "Name of the sample to process"
        input_file: "Input file to process"
    }
}

task DebugTask {
    input {
        String sample
    }
    
    command <<<
        echo "Debug mode for sample: ~{sample}" > debug.log
    >>>
    
    output {
        File debug_file = "debug.log"
    }
    
    runtime {
        container: "alpine:latest"
    }
}