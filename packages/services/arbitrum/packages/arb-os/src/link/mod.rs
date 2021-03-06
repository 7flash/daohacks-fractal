/*
 * Copyright 2020, Offchain Labs, Inc. All rights reserved.
 */

//!Provides types and utilities for linking together compiled mini programs

use crate::compile::{
    CompileError, CompiledProgram, DebugInfo, GlobalVarDecl, SourceFileMap, Type,
};
use crate::mavm::{AVMOpcode, Instruction, Label, Opcode, Value};
use crate::pos::try_display_location;
use crate::stringtable::{StringId, StringTable};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::{DefaultHasher, HashMap};
use std::collections::BTreeMap;
use std::hash::Hasher;
use std::io;
use xformcode::make_uninitialized_tuple;

pub use xformcode::{value_from_field_list, TupleTree, TUPLE_SIZE};

mod optimize;
mod striplabels;
mod xformcode;

///Represents a mini program that has gone through the post-link compilation step.
///
/// This is typically constructed via the `postlink_compile` function.
#[derive(Serialize, Deserialize)]
pub struct LinkedProgram {
    pub code: Vec<Instruction<AVMOpcode>>,
    pub static_val: Value,
    pub globals: Vec<GlobalVarDecl>,
    #[serde(default)]
    pub file_name_chart: BTreeMap<u64, String>,
}

impl LinkedProgram {
    ///Serializes self to the format specified by the format argument, with a default of json for
    /// None. The output is written to a dynamically dispatched implementor of `std::io::Write`,
    /// specified by the output argument.
    pub fn to_output(&self, output: &mut dyn io::Write, format: Option<&str>) {
        match format {
            Some("pretty") => {
                writeln!(output, "static: {}", self.static_val).unwrap();
                for (idx, insn) in self.code.iter().enumerate() {
                    writeln!(
                        output,
                        "{:05}:  {} \t\t {}",
                        idx,
                        insn,
                        try_display_location(
                            insn.debug_info.location,
                            &self.file_name_chart,
                            false
                        )
                    )
                    .unwrap();
                }
            }
            None | Some("json") => match serde_json::to_string(self) {
                Ok(prog_str) => {
                    writeln!(output, "{}", prog_str).unwrap();
                }
                Err(e) => {
                    writeln!(output, "json serialization error: {:?}", e).unwrap();
                }
            },
            Some("bincode") => match bincode::serialize(self) {
                Ok(encoded) => {
                    if let Err(e) = output.write_all(&encoded) {
                        writeln!(output, "bincode write error: {:?}", e).unwrap();
                    }
                }
                Err(e) => {
                    writeln!(output, "bincode serialization error: {:?}", e).unwrap();
                }
            },
            Some(weird_value) => {
                writeln!(output, "invalid format: {}", weird_value).unwrap();
            }
        }
    }
}

///Represents an import generated by a `use` statement.
#[derive(Clone, Debug)]
pub struct Import {
    ///Module path, relative to logical program root.
    pub path: Vec<String>,
    ///Name of `Type` or function to be imported.
    pub name: String,
}

impl Import {
    pub fn new(path: Vec<String>, name: String) -> Self {
        Import { path, name }
    }
}

///Represents a function imported from another mini program or module.
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct ImportedFunc {
    pub name_id: StringId,
    pub slot_num: usize,
    pub name: String,
}

impl ImportedFunc {
    pub fn new(slot_num: usize, name_id: StringId, string_table: &StringTable) -> Self {
        ImportedFunc {
            name_id,
            slot_num,
            name: string_table.name_from_id(name_id).to_string(),
        }
    }

    ///Takes self by value and returns self with slot_number increased by ext_offset. Used to assign
    /// unique slot numbers when linking multiple source files.
    pub fn relocate(mut self, _int_offset: usize, ext_offset: usize) -> Self {
        self.slot_num += ext_offset;
        self
    }
}

///Represents a function that is part of the modules public interface.  The label field represents
/// the start location of the function in the program it is contained in.
///
/// This struct differs from `ExportedFuncPoint` because the label field points to a virtual label
/// rather than an absolute address.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedFunc {
    pub name: String,
    pub label: Label,
    pub tipe: Type,
}

impl ExportedFunc {
    ///Takes self by value and returns a tuple. The first field of the tuple is self with internal,
    /// external, and function references increased by int_offset, ext_offset, and func_offset
    /// instructions respectively.  The second field is the instruction after the end of self,
    /// calculated by taking the sum of func_offset and the function length.
    pub fn relocate(
        self,
        int_offset: usize,
        ext_offset: usize,
        func_offset: usize,
    ) -> (Self, usize) {
        let (relocated_label, new_func_offset) =
            self.label.relocate(int_offset, ext_offset, func_offset);
        (
            ExportedFunc {
                name: self.name,
                label: relocated_label,
                tipe: self.tipe,
            },
            new_func_offset,
        )
    }
}

impl ExportedFunc {
    pub fn new(name_id: StringId, label: Label, tipe: Type, string_table: &StringTable) -> Self {
        Self {
            name: string_table.name_from_id(name_id).to_string(),
            label,
            tipe,
        }
    }
}

///Converts a linked `CompiledProgram` into a `LinkedProgram` by fixing non-forward jumps,
/// converting wide tuples to nested tuples, performing code optimizations, converting the jump
/// table to a static value, and combining the file name chart with the associated argument.
pub fn postlink_compile(
    program: CompiledProgram,
    mut file_name_chart: BTreeMap<u64, String>,
    test_mode: bool,
    debug: bool,
) -> Result<LinkedProgram, CompileError> {
    if debug {
        println!("========== after initial linking ===========");
        for (idx, insn) in program.code.iter().enumerate() {
            println!("{:04}:  {}", idx, insn);
        }
    }
    let (code_2, jump_table) = striplabels::fix_nonforward_labels(
        &program.code,
        &program.imported_funcs,
        program.globals.len() - 1,
    );
    if debug {
        println!("========== after fix_backward_labels ===========");
        for (idx, insn) in code_2.iter().enumerate() {
            println!("{:04}:  {}", idx, insn);
        }
    }
    let code_3 = xformcode::fix_tuple_size(&code_2, program.globals.len())?;
    if debug {
        println!("=========== after fix_tuple_size ==============");
        for (idx, insn) in code_3.iter().enumerate() {
            println!("{:04}:  {}", idx, insn);
        }
    }
    let code_4 = optimize::peephole(&code_3);
    if debug {
        println!("============ after peephole optimization ===========");
        for (idx, insn) in code_4.iter().enumerate() {
            println!("{:04}:  {}", idx, insn);
        }
    }
    let (mut code_5, jump_table_final) =
        striplabels::strip_labels(code_4, &jump_table, &program.imported_funcs)?;
    let jump_table_value = xformcode::jump_table_to_value(jump_table_final);

    hardcode_jump_table_into_register(&mut code_5, &jump_table_value, test_mode);
    let code_final: Vec<_> = code_5
        .into_iter()
        .map(|insn| {
            if let Opcode::AVMOpcode(inner) = insn.opcode {
                Ok(Instruction::new(inner, insn.immediate, insn.debug_info))
            } else {
                Err(CompileError::new(
                    format!("In final output encountered virtual opcode {}", insn.opcode),
                    insn.debug_info.location,
                ))
            }
        })
        .collect::<Result<Vec<_>, CompileError>>()?;

    if debug {
        println!("============ after strip_labels =============");
        println!("static: {}", jump_table_value);
        for (idx, insn) in code_final.iter().enumerate() {
            println!("{:04}:  {}", idx, insn);
        }
        println!("============ after full compile/link =============");
    }

    file_name_chart.extend(program.file_name_chart);

    Ok(LinkedProgram {
        code: code_final,
        static_val: Value::none(),
        globals: program.globals,
        file_name_chart,
    })
}

fn hardcode_jump_table_into_register(
    code: &mut Vec<Instruction>,
    jump_table: &Value,
    test_mode: bool,
) {
    let offset = if test_mode { 1 } else { 2 };
    let old_imm = code[offset].clone().immediate.unwrap();
    code[offset] = Instruction::from_opcode_imm(
        code[offset].opcode,
        old_imm.replace_last_none(jump_table),
        code[offset].debug_info,
    );
}

///Combines the `CompiledProgram`s in progs_in into a single `CompiledProgram` with offsets adjusted
/// to avoid collisions and auto-linked programs added.
///
/// Also prints a warning message to the console if import and export types between modules don't
/// match.
pub fn link(
    progs_in: &[CompiledProgram],
    test_mode: bool,
) -> Result<CompiledProgram, CompileError> {
    let progs = progs_in.to_vec();
    let mut insns_so_far: usize = 3; // leave 2 insns of space at beginning for initialization
    let mut imports_so_far: usize = 0;
    let mut int_offsets = Vec::new();
    let mut ext_offsets = Vec::new();
    let mut merged_source_file_map = SourceFileMap::new_empty();
    let mut global_num_limit = vec![];

    for prog in &progs {
        merged_source_file_map.push(
            prog.code.len(),
            match &prog.source_file_map {
                Some(sfm) => sfm.get(0),
                None => "".to_string(),
            },
        );
        int_offsets.push(insns_so_far);
        insns_so_far += prog.code.len();
        ext_offsets.push(imports_so_far);
        imports_so_far += prog.imported_funcs.len();
    }

    let mut relocated_progs = Vec::new();
    let mut func_offset: usize = 0;
    for (i, prog) in progs.iter().enumerate() {
        let (relocated_prog, new_func_offset) = prog.clone().relocate(
            int_offsets[i],
            ext_offsets[i],
            func_offset,
            global_num_limit,
            prog.clone().source_file_map,
        );
        global_num_limit = relocated_prog.globals.clone();
        relocated_progs.push(relocated_prog);
        func_offset = new_func_offset + 1;
    }

    global_num_limit.push(GlobalVarDecl::new(
        usize::MAX,
        "_jump_table".to_string(),
        Type::Any,
        None,
    ));

    // Initialize globals or allow jump table retrieval
    let mut linked_code = if test_mode {
        vec![
            Instruction::from_opcode_imm(
                Opcode::AVMOpcode(AVMOpcode::Noop),
                Value::none(),
                DebugInfo::default(),
            ),
            Instruction::from_opcode_imm(
                Opcode::AVMOpcode(AVMOpcode::Noop),
                make_uninitialized_tuple(global_num_limit.len()),
                DebugInfo::default(),
            ),
            Instruction::from_opcode(Opcode::AVMOpcode(AVMOpcode::Rset), DebugInfo::default()),
        ]
    } else {
        vec![
            Instruction::from_opcode(Opcode::AVMOpcode(AVMOpcode::Rget), DebugInfo::default()),
            Instruction::from_opcode_imm(
                Opcode::AVMOpcode(AVMOpcode::Noop),
                Value::none(),
                DebugInfo::default(),
            ),
            Instruction::from_opcode_imm(
                Opcode::AVMOpcode(AVMOpcode::Rset),
                make_uninitialized_tuple(global_num_limit.len()),
                DebugInfo::default(),
            ),
        ]
    };

    let mut linked_exports = Vec::new();
    let mut linked_imports = Vec::new();
    for mut rel_prog in relocated_progs {
        linked_code.append(&mut rel_prog.code);
        linked_exports.append(&mut rel_prog.exported_funcs);
        linked_imports.append(&mut rel_prog.imported_funcs);
    }

    let mut exports_map = HashMap::new();
    let mut label_xlate_map = HashMap::new();
    for exp in &linked_exports {
        exports_map.insert(exp.name.clone(), exp.label);
    }
    for imp in &linked_imports {
        if let Some(label) = exports_map.get(&imp.name) {
            label_xlate_map.insert(Label::External(imp.slot_num), label);
        } else {
            println!(
                "Warning: {}",
                CompileError::new(format!("Failed to resolve import \"{}\"", imp.name), None)
            );
        }
    }

    let mut linked_xlated_code = Vec::new();
    for insn in linked_code {
        linked_xlated_code.push(insn.xlate_labels(&label_xlate_map));
    }

    Ok(CompiledProgram::new(
        linked_xlated_code,
        linked_exports,
        linked_imports,
        global_num_limit,
        Some(merged_source_file_map),
        {
            let mut map = HashMap::new();
            let mut file_hasher = DefaultHasher::new();
            file_hasher.write(b"builtin/array.mini");
            map.insert(file_hasher.finish(), "builtin/array.mini".to_string());
            let mut file_hasher = DefaultHasher::new();
            file_hasher.write(b"builtin/kvs.mini");
            map.insert(file_hasher.finish(), "builtin/kvs.mini".to_string());
            map
        },
    ))
}
