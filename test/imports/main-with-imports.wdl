version 2.0

import "./utils.wdl" as utils
import "./enhanced-features.wdl" as enhanced

workflow MainWorkflow {
    input {
        File sample_file
        String sample_text
        Array[String] sample_list
    }
    
    # Call imported task with alias
    call utils.ValidateFile {
        input:
            input_file = sample_file,
            min_size = 100
    }
    
    # Call another imported task
    call utils.ProcessText {
        input:
            input_text = sample_text,
            operation = "uppercase"
    }
    
    # Use output from one task as input to another
    if (utils.ValidateFile.is_valid) {
        call enhanced.ProcessSample {
            input:
                sample = sample_info,
                config = processing_config,
                prep_method = utils.ProcessText.processed_text
        }
    }
    
    output {
        Boolean file_is_valid = utils.ValidateFile.is_valid
        String processed_text = utils.ProcessText.processed_text
        File? processed_sample = enhanced.ProcessSample.output_file
    }
}