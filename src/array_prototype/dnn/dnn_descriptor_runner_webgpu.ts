/// <reference path="../dnn_buffer_webgpu.ts" />
/// <reference path="../webgpu_handler.ts" />
/// <reference path="./dnn_descriptor_runner.ts" />

namespace WebDNN {
    export class DNNDescriptorRunnerWebGPU implements DNNDescriptorRunner {
        private weightMat: DNNBufferWebGPU;
        private dataMat: DNNBufferWebGPU;
        private metaBufferGPUBuffers: DNNBufferWebGPU[];

        constructor(public descriptor: DNNDescriptorWebGPU, private webGPUHandler: WebGPUHandler) {

        }

        async compile() {
            this.webGPUHandler.loadKernel(this.descriptor.kernel_source, 'descriptor');
            this.weightMat = new DNNBufferWebGPU(this.descriptor.weight_allocation.total_size * Float32Array.BYTES_PER_ELEMENT);
            this.dataMat = new DNNBufferWebGPU(this.descriptor.variable_allocation.total_size * Float32Array.BYTES_PER_ELEMENT);
            this.metaBufferGPUBuffers = [];
            for (let i = 0; i < this.descriptor.exec_infos.length; i++) {
                let exec_info = this.descriptor.exec_infos[i];
                let buf = new DNNBufferWebGPU(exec_info.meta_buffer.length * Float32Array.BYTES_PER_ELEMENT);
                await buf.write(new Uint8Array(exec_info.meta_buffer));
                this.metaBufferGPUBuffers.push(buf);
            }
        }

        async loadWeights(weightsData: Float32Array) {
            await this.weightMat.write(weightsData);
        }

        async getInputViews(): Promise<Float32Array[]> {
            let views: Float32Array[] = [];
            for (let i = 0; i < this.descriptor.inputs.length; i++) {
                let var_alloc = this.descriptor.variable_allocation.allocation[this.descriptor.inputs[i]];
                views.push(<Float32Array>this.dataMat.getWriteView(var_alloc.offset, var_alloc.size, Float32Array));
            }
            return views;
        }

        async getOutputViews(): Promise<Float32Array[]> {
            let views: Float32Array[] = [];
            for (let i = 0; i < this.descriptor.inputs.length; i++) {
                let var_alloc = this.descriptor.variable_allocation.allocation[this.descriptor.outputs[i]];
                views.push(<Float32Array>this.dataMat.getReadView(var_alloc.offset, var_alloc.size, Float32Array));
            }
            return views;
        }

        async run(): Promise<void> {
            //set input to GPU
            //await this.dataMat.syncWriteViews();//not needed for DNNBufferWebGPU
            if (window['PROFILE']) {
                let results: any = [];
                for (let i = 0; i < this.descriptor.exec_infos.length; i++) {
                    let exec_info = this.descriptor.exec_infos[i];

                    let start = performance.now();
                    await this.webGPUHandler.executeSinglePipelineState(
                        'descriptor.' + exec_info.entry_func_name,
                        exec_info.threadgroups_per_grid,
                        exec_info.threads_per_thread_group,
                        [this.weightMat, this.dataMat, this.metaBufferGPUBuffers[i]],
                        true
                    );
                    let elapsedTime = performance.now() - start;
                    results.push({
                        'Kernel': exec_info.entry_func_name,
                        'Elapsed time [ms]': elapsedTime
                    });
                }
                console.table(results);

            } else {
                //execute kernels
                let complete_promise: Promise<void> | null = null;
                for (let i = 0; i < this.descriptor.exec_infos.length; i++) {
                    let exec_info = this.descriptor.exec_infos[i];
                    let is_last = i == this.descriptor.exec_infos.length - 1;
                    complete_promise = this.webGPUHandler.executeSinglePipelineState(
                        'descriptor.' + exec_info.entry_func_name,
                        exec_info.threadgroups_per_grid,
                        exec_info.threads_per_thread_group,
                        [this.weightMat, this.dataMat, this.metaBufferGPUBuffers[i]],
                        is_last
                    );
                }
                await complete_promise!;//wait to finish final kernel

                // get output from GPU
                //await this.dataMat.syncReadViews();//not needed for DNNBufferWebGPU
            }
        }
    }

    export interface DNNDescriptorWebGPU {
        kernel_source: string;
        exec_infos: DNNDescriptorWebGPUExecInfos[];
        weight_allocation: {
            total_size: number;
            allocation: { [index: string]: { name: string, offset: number, size: number } }
        };
        variable_allocation: {
            total_size: number;
            allocation: { [index: string]: { name: string, offset: number, size: number } }
        };
        inputs: string[];
        outputs: string[];
    }

    export interface DNNDescriptorWebGPUExecInfos {
        entry_func_name: string;
        threadgroups_per_grid: WebGPUSize;
        threads_per_thread_group: WebGPUSize;
        meta_buffer: number[];
    }
}
