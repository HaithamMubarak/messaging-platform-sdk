package com.hmdev.sdk.local.repository;

import com.hmdev.sdk.local.model.TerminalSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface TerminalSessionRepository extends JpaRepository<TerminalSession, String> {
    List<TerminalSession> findByStatus(String status);
}

