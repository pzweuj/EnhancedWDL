version 2.0

task ValidateFile {
    input {
        File input_file
        Int min_size = 0
    }
    
    command <<<
        if [ -f "~{input_file}" ] && [ $(stat -c%s "~{input_file}") -gt ~{min_size} ]; then
            echo "valid"
        else
            echo "invalid"
        fi
    >>>
    
    output {
        String validation_result = read_string(stdout())
        Boolean is_valid = validation_result == "valid"
    }
    
    runtime {
        container: "ubuntu:20.04"
        cpu: 1
        memory: "1GB"
    }
    
    meta {
        description: "Validate that a file exists and meets minimum size requirements"
    }
    
    parameter_meta {
        input_file: "File to validate"
        min_size: "Minimum file size in bytes"
    }
}

task ProcessText {
    input {
        String input_text
        String operation = "uppercase"
    }
    
    command <<<
        case "~{operation}" in
            "uppercase")
                echo "~{input_text}" | tr '[:lower:]' '[:upper:]'
                ;;
            "lowercase")
                echo "~{input_text}" | tr '[:upper:]' '[:lower:]'
                ;;
            *)
                echo "~{input_text}"
                ;;
        esac
    >>>
    
    output {
        String processed_text = read_string(stdout())
    }
    
    runtime {
        container: "ubuntu:20.04"
        cpu: 1
        memory: "512MB"
    }
}