package com.hmdev.sdk.local.controller;

import com.hmdev.sdk.local.model.Note;
import com.hmdev.sdk.local.service.NoteService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * REST Controller for managing notes
 * Provides endpoints for creating, reading, updating, and deleting notes
 */
@Slf4j
@RestController
@RequestMapping("/api/notes")
@RequiredArgsConstructor
@CrossOrigin(origins = "*", allowedHeaders = "*", methods = {RequestMethod.GET, RequestMethod.POST, RequestMethod.PUT, RequestMethod.DELETE, RequestMethod.OPTIONS})
public class NoteController {

    private final NoteService noteService;

    /**
     * Get all notes
     */
    @GetMapping
    public ResponseEntity<List<Note>> getAllNotes() {
        log.info("[NoteController] Getting all notes");
        List<Note> notes = noteService.getAllNotes();
        return ResponseEntity.ok(notes);
    }

    /**
     * Get a specific note by ID
     */
    @GetMapping("/{id}")
    public ResponseEntity<Note> getNoteById(@PathVariable String id) {
        log.info("[NoteController] Getting note: {}", id);
        return noteService.getNoteById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Create a new note
     */
    @PostMapping
    public ResponseEntity<Note> createNote(@RequestBody Note note) {
        log.info("[NoteController] Creating new note: {}", note.getTitle());
        Note created = noteService.createNote(note);
        return ResponseEntity.ok(created);
    }

    /**
     * Update an existing note
     */
    @PutMapping("/{id}")
    public ResponseEntity<Note> updateNote(@PathVariable String id, @RequestBody Note note) {
        log.info("[NoteController] Updating note: {}", id);
        note.setId(id);
        Note updated = noteService.updateNote(note);
        return ResponseEntity.ok(updated);
    }

    /**
     * Delete a note
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteNote(@PathVariable String id) {
        log.info("[NoteController] Deleting note: {}", id);
        noteService.deleteNote(id);
        return ResponseEntity.ok().build();
    }

    /**
     * Get all shared notes
     */
    @GetMapping("/shared")
    public ResponseEntity<List<Note>> getSharedNotes() {
        log.info("[NoteController] Getting shared notes");
        List<Note> sharedNotes = noteService.getSharedNotes();
        return ResponseEntity.ok(sharedNotes);
    }
}

