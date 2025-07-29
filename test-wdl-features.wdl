version 2.0

task ProcessSample {
    input {
        String sample_name
        File input_file
        Int cpu_count = 4
        Float memory_gb = 8.0
        Boolean debug = false
    }
    
    command <<<
        echo "Processing sample: ~{sample_name}"
        cat ~{input_file} > ~{sample_name}.processed
    >>>
    
    output {
        File output_file = "~{sample_name}.processed"
        String log_message = "Sample processed successfully"
    }
    
    runtime {
        container: "ubuntu:20.04"
        cpu: cpu_count
        memory: "~{memory_gb}GB"
    }
    
    meta {
        description: "Process a single sample file"
    }
    
    parameter_meta {
        sample_name: "Name of the sample to process"
        input_file: "Input file to process"
        cpu_count: "Number of CPUs to use"
        memory_gb: "Memory in GB"
        debug: "Enable debug mode"
    }
}

task QualityCheck {
    input {
        File input_file
        Float min_quality = 30.0
    }
    
    command <<<
        echo "Quality check for ~{input_file}"
    >>>
    
    output {
        File quality_report = "quality_report.txt"
        Boolean passed = true
    }
}

workflow TestWorkflow {
    input {
        String sample_id
        File raw_file
    }
    
    call ProcessSample {
        input:
            sample_name = sample_id,
            input_file = raw_file
    }
    
    call QualityCheck {
        input:
            input_file = ProcessSample.output_file
    }
    
    output {
        File final_output = ProcessSample.output_file
        File quality_report = QualityCheck.quality_report
        Boolean quality_passed = QualityCheck.passed
    }
}