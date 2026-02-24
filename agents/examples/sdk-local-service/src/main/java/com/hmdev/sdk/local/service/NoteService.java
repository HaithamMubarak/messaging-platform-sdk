package com.hmdev.sdk.local.service;

import com.hmdev.sdk.local.model.Note;
import com.hmdev.sdk.local.repository.NoteRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Service for managing notes
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NoteService {

    private final NoteRepository noteRepository;

    /**
     * Get all notes
     */
    public List<Note> getAllNotes() {
        return noteRepository.findAll();
    }

    /**
     * Get a note by ID
     */
    public Optional<Note> getNoteById(String id) {
        return noteRepository.findById(id);
    }

    /**
     * Create a new note
     */
    @Transactional
    public Note createNote(Note note) {
        if (note.getId() == null || note.getId().isEmpty()) {
            note.setId(UUID.randomUUID().toString());
        }

        if (note.getCreatedAt() == null) {
            note.setCreatedAt(LocalDateTime.now());
        }

        if (note.getUpdatedAt() == null) {
            note.setUpdatedAt(LocalDateTime.now());
        }

        log.info("[NoteService] Creating note: {} - {}", note.getId(), note.getTitle());
        return noteRepository.save(note);
    }

    /**
     * Update an existing note
     */
    @Transactional
    public Note updateNote(Note note) {
        note.setUpdatedAt(LocalDateTime.now());

        log.info("[NoteService] Updating note: {} - {}", note.getId(), note.getTitle());
        return noteRepository.save(note);
    }

    /**
     * Delete a note
     */
    @Transactional
    public void deleteNote(String id) {
        log.info("[NoteService] Deleting note: {}", id);
        noteRepository.deleteById(id);
    }

    /**
     * Get all shared notes
     */
    public List<Note> getSharedNotes() {
        return noteRepository.findBySharedTrue();
    }

    /**
     * Get notes by owner (for shared notes from other agents)
     */
    public List<Note> getNotesByOwner(String owner) {
        return noteRepository.findByOwner(owner);
    }
}

