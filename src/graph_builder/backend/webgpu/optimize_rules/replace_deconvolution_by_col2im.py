from graph_builder.backend.webgpu.operators.col2im import Col2Im
from graph_builder.backend.webgpu.operators.sgemm import Sgemm
from graph_builder.graph.axis import Axis
from graph_builder.graph.operator import Operator
from graph_builder.graph.operators.deconvolution2d import Deconvolution2D
from graph_builder.graph.variables.attributes.order import OrderNHWC, OrderCNHW
from graph_builder.optimizer import util
from graph_builder.optimizer.optimize_rule import OptimizeRule


class ReplaceDeconvolutionByCol2Im(OptimizeRule):
    """
    Deconvolution2Dをsgemm + Col2Imに置換する
    """

    def __call__(self, graph: Operator):
        flag_changed = False
        for op in util.listup_operator_in_order(graph):
            if not isinstance(op, Deconvolution2D):
                continue

            op: Deconvolution2D

            x = op.inputs["x"]
            w = op.inputs["w"]
            old_y = op.outputs["y"]

            flag_changed = True
            op.remove_all()

            assert x.axis_order == OrderNHWC
            w.change_axis_order(OrderCNHW)
            assert old_y.axis_order == OrderNHWC

            sgemm = Sgemm("sgemm", {
                "M": x.shape_dict[Axis.N] * x.shape_dict[Axis.H] * x.shape_dict[Axis.W],
                "N": w.shape_dict[Axis.N] * w.shape_dict[Axis.H] * w.shape_dict[Axis.W],
                "K": x.shape_dict[Axis.C],
                "out_shape": [x.shape_dict[Axis.N],
                              x.shape_dict[Axis.H],
                              x.shape_dict[Axis.W],
                              w.shape_dict[Axis.N] * w.shape_dict[Axis.H] * w.shape_dict[Axis.W]
                              ],
                "out_order": OrderNHWC,
            })
            col, = sgemm(x, w)

            col2im = Col2Im("col2im", {
                "ksize": op.ksize,
                "stride": op.stride,
                "padding": op.padding,
            })
            new_y, = col2im(col)

            new_y.merge(old_y)

        return graph, flag_changed
