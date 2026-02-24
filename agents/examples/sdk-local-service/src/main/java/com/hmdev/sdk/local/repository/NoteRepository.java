package com.hmdev.sdk.local.repository;

import com.hmdev.sdk.local.model.Note;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Repository for Note entities
 */
@Repository
public interface NoteRepository extends JpaRepository<Note, String> {

    /**
     * Find all shared notes
     */
    List<Note> findBySharedTrue();

    /**
     * Find notes by owner (for shared notes from other agents)
     */
    List<Note> findByOwner(String owner);
}

