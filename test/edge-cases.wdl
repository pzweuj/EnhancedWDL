version 2.0
# Edge cases for WDL syntax highlighting

workflow EdgeCases {
    input {
        # Complex nested types
        Array[Map[String, Pair[Int, Float]]] complex_data
        Map[String, Array[File?]] optional_files
        
        # String with multiple interpolations
        String complex_string = "prefix ~{var1} middle ${var2 + var3} suffix"
        
        # Nested expressions in interpolation
        String nested_expr = "result: ~{if defined(x) then x else 'default'}"
    }
    
    # Nested conditionals
    if (defined(complex_data)) {
        if (length(complex_data) > 0) {
            call NestedTask
        } else {
            call EmptyTask
        }
    }
    
    # Complex scatter with filtering
    scatter (item in select_all([file1, file2, file3])) {
        if (size(item) > 1000) {
            call ProcessLargeFile { input: file=item }
        }
    }
}

task ComplexCommand {
    input {
        String sample
        Array[File] inputs
        Map[String, String] params
    }
    
    command <<<
        # Complex shell script with multiple interpolations
        set -euo pipefail
        
        SAMPLE="~{sample}"
        echo "Processing sample: $SAMPLE"
        
        # Array handling
        FILES=(~{sep=' ' inputs})
        for file in "${FILES[@]}"; do
            echo "Processing file: $file"
            
            # Nested command substitution
            SIZE=$(stat -c%s "$file")
            if [ "$SIZE" -gt 1000 ]; then
                echo "Large file: $file ($SIZE bytes)"
            fi
        done
        
        # Map parameter handling
        ~{sep='\n' prefix='export ' suffix='' pairs=params}
        
        # Complex conditional in shell
        if [[ "~{sample}" =~ ^[A-Z]{2}[0-9]{4}$ ]]; then
            echo "Valid sample ID format"
        else
            echo "Invalid sample ID: ~{sample}" >&2
            exit 1
        fi
        
        # Here document
        cat << 'EOF' > config.txt
        This is a here document
        With ~{sample} interpolation that should NOT be highlighted
        Because it's in single quotes
EOF
        
        # But this should be highlighted
        cat << EOF > config2.txt
        Sample: ~{sample}
        Count: ~{length(inputs)}
EOF
    >>>
    
    output {
        File result = "result.txt"
        Array[File] processed = glob("*.processed")
    }
    
    runtime {
        # Runtime with complex expressions
        container: "ubuntu:~{if defined(version) then version else '20.04'}"
        cpu: select_first([cpu_override, 4])
        memory: "~{memory_gb}GB"
        disk: "~{disk_gb}GB"
        preemptible: true
        maxRetries: 2
    }
}

# Task with parameter_meta containing complex descriptions
task DocumentedTask {
    input {
        String input_param
        Int? optional_param
    }
    
    command <<<
        echo "~{input_param}" > output.txt
        ~{if defined(optional_param) then "echo 'Optional: " + optional_param + "' >> output.txt" else ""}
    >>>
    
    output {
        File output_file = "output.txt"
    }
    
    parameter_meta {
        input_param: {
            description: "Input parameter with special characters: !@#$%^&*()",
            help: "This parameter accepts strings with 'quotes' and \"double quotes\""
        }
        optional_param: "Optional integer parameter (can be null)"
    }
    
    meta {
        author: "Test Author <test@example.com>"
        version: "1.0.0"
        description: "A task for testing parameter_meta and meta blocks"
    }
}