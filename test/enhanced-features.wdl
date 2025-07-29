version 2.0
# Enhanced WDL features test

# Struct definition (WDL 2.0 feature)
struct SampleInfo {
    String sample_id
    File fastq_r1
    File fastq_r2
    String? library_prep
    Int read_length
    Float quality_score
}

struct ProcessingConfig {
    Int cpu_count
    Float memory_gb
    String container_image
    Map[String, String] env_vars
}

import "./utils/helpers.wdl" as utils

workflow EnhancedWorkflow {
    input {
        Array[SampleInfo] samples
        ProcessingConfig config
        Map[String, Array[File]] reference_files
        Pair[String, Int] version_info
    }
    
    # Using builtin functions
    Array[String] sample_ids = select_all(flatten([samples.sample_id]))
    Int total_samples = length(samples)
    String output_prefix = basename(samples[0].fastq_r1, ".fastq.gz")
    
    # Complex type usage
    Map[String, Pair[File, File]] paired_files = {}
    Array[File?] optional_outputs = []
    
    scatter (sample_info in samples) {
        # Using defined() builtin function
        if (defined(sample_info.library_prep)) {
            String prep_method = select_first([sample_info.library_prep, "standard"])
            
            call ProcessSample {
                input:
                    sample = sample_info,
                    config = config,
                    prep_method = prep_method
            }
        }
        
        # Using size() and other builtins
        if (size(sample_info.fastq_r1) > 1000000) {
            call utils.QualityCheck {
                input: 
                    fastq = sample_info.fastq_r1,
                    min_quality = sample_info.quality_score
            }
        }
    }
    
    # Using zip, cross, and other collection functions
    Array[Pair[String, File]] sample_file_pairs = zip(sample_ids, ProcessSample.output_file)
    Array[Array[String]] crossed_data = cross([sample_ids, ["A", "B", "C"]])
    
    output {
        Array[File] processed_files = select_all(ProcessSample.output_file)
        Map[String, File] sample_to_file = as_map(sample_file_pairs)
        String summary = "Processed ~{total_samples} samples"
    }
}

task ProcessSample {
    input {
        SampleInfo sample
        ProcessingConfig config
        String prep_method
    }
    
    # Complex parameter usage
    String sample_name = sample.sample_id
    Int cpu = config.cpu_count
    Float memory = config.memory_gb
    
    command <<<
        set -euo pipefail
        
        # Using struct members in command
        echo "Processing sample: ~{sample.sample_id}"
        echo "Library prep: ~{prep_method}"
        echo "Read length: ~{sample.read_length}"
        
        # Environment variables from map
        ~{sep='\n' prefix='export ' suffix='' pairs=config.env_vars}
        
        # File processing
        INPUT_R1="~{sample.fastq_r1}"
        INPUT_R2="~{sample.fastq_r2}"
        OUTPUT="~{sample_name}.processed.bam"
        
        # Complex shell logic with WDL interpolation
        if [[ ~{sample.read_length} -gt 100 ]]; then
            echo "Long read processing"
            EXTRA_ARGS="--long-reads"
        else
            echo "Short read processing"
            EXTRA_ARGS="--short-reads"
        fi
        
        # Using builtin functions in command
        QUALITY_THRESHOLD=~{floor(sample.quality_score)}
        echo "Quality threshold: $QUALITY_THRESHOLD"
        
        # Simulate processing
        echo "Processed ~{sample_name}" > "$OUTPUT"
    >>>
    
    output {
        File output_file = "~{sample_name}.processed.bam"
        String processing_log = stdout()
        String error_log = stderr()
    }
    
    runtime {
        container: config.container_image
        cpu: config.cpu_count
        memory: "~{config.memory_gb}GB"
        disk: "~{ceil(size(sample.fastq_r1) + size(sample.fastq_r2)) * 3}GB"
    }
    
    meta {
        description: "Process a sample using struct-based configuration"
        version: "2.0"
    }
    
    parameter_meta {
        sample: {
            description: "Sample information struct",
            help: "Contains all necessary sample metadata"
        }
        config: {
            description: "Processing configuration struct",
            help: "Runtime and processing parameters"
        }
    }
}

# Task demonstrating advanced string manipulation
task StringProcessing {
    input {
        Array[String] input_strings
        String pattern
        String replacement
    }
    
    command <<<
        # Using advanced string functions
        python3 << 'EOF'
        import re
        
        inputs = [~{sep=', ' quote(input_strings)}]
        pattern = r"~{pattern}"
        replacement = "~{replacement}"
        
        for i, s in enumerate(inputs):
            result = re.sub(pattern, replacement, s)
            print(f"String {i}: {s} -> {result}")
        EOF
    >>>
    
    output {
        Array[String] processed_strings = read_lines(stdout())
    }
    
    runtime {
        container: "python:3.9-slim"
        cpu: 1
        memory: "1GB"
    }
}